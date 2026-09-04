// /api/send-decision.js
//
// Sends the human-reviewed admissions decision to an applicant and marks
// the application decided. A human must choose the decision explicitly —
// this endpoint never sends the AI's raw recommendation automatically.
// Authenticated via a real Clerk admin session (see lib/admin-auth.js) —
// this write endpoint authorizes independently of the read endpoint, on
// every request.
// Requires CLERK_SECRET_KEY, ADMIN_CLERK_USER_ID, DATABASE_URL,
// RESEND_API_KEY, FROM_EMAIL.
//
// POST /api/send-decision.js
//   Authorization: Bearer <Clerk session token>
//   { id, decision, internalNote, applicantMessage }
//
// internalNote     -> database (applications.internal_note) / admin only,
//                      NEVER inserted into the outgoing applicant email.
// applicantMessage -> database (applications.applicant_message), MAY
//                      appear in the applicant's decision email.
// Deliberately two separate fields, not one ambiguous "note" — a prior
// version stored a single note and emailed that same text verbatim,
// which meant anything an admin typed as an internal reminder to
// themselves was also sent to the applicant.
//
// Idempotent: an application can only be decided once. A double-click,
// browser retry, or network retry against an already-decided application
// is a no-op that returns the existing decision rather than re-sending
// the email, re-inviting the portal, or overwriting the stored decision.

const { getPool } = require('../lib/db');
const { sendDecisionEmail } = require('../lib/email');
const { createPortalInvitation } = require('../lib/clerk');
const { VALID_RECOMMENDATIONS } = require('../lib/scoring');
const { requireAdmin, legacySecretAuthorized } = require('../lib/admin-auth');

const PORTAL_DECISIONS = ['ACCEPT', 'ACCEPT_WITH_CONDITIONS'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secret, id, decision, internalNote, applicantMessage } = req.body || {};

  if (!legacySecretAuthorized(secret)) {
    const adminId = await requireAdmin(req, res);
    if (!adminId) return; // requireAdmin already wrote the 401/403/503 response
  }

  if (!id || !VALID_RECOMMENDATIONS.includes(decision)) {
    return res.status(400).json({ error: 'A valid application id and decision are required.' });
  }

  const cleanApplicantMessage = applicantMessage ? String(applicantMessage).slice(0, 2000) : '';
  const cleanInternalNote = internalNote ? String(internalNote).slice(0, 4000) : '';

  // Double-click / browser-retry / network-retry protection: hold a
  // Postgres row lock (SELECT ... FOR UPDATE) on this application for the
  // whole decide-and-send, and only flip status to 'decided' after the
  // email actually succeeds. A concurrent duplicate request blocks on the
  // same lock, then — once this transaction commits — sees status already
  // 'decided' and returns the idempotent response below instead of
  // sending a second email or recording a conflicting decision. If the
  // email send throws, the transaction rolls back and status is left
  // exactly as it was, so a genuine retry after a real failure still works.
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT full_name, email, access_token, status, decision
       FROM applications WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const application = result.rows[0];
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found.' });
    }

    if (application.status === 'decided') {
      await client.query('ROLLBACK');
      return res.status(200).json({ id, status: 'decided', decision: application.decision, alreadyDecided: true });
    }

    await sendDecisionEmail({
      to: application.email,
      name: application.full_name,
      decision,
      applicantMessage: cleanApplicantMessage,
      selectProgramUrl: `${process.env.SITE_URL}/select-program.html?token=${encodeURIComponent(application.access_token)}`,
    });

    if (PORTAL_DECISIONS.includes(decision)) {
      try {
        await createPortalInvitation({ email: application.email, name: application.full_name });
      } catch (invitationErr) {
        // Don't fail the whole decision over a portal-invite hiccup — the
        // applicant still got their decision email, and an admin can
        // re-invite manually from Clerk's dashboard if needed.
        console.error('Portal invitation error:', invitationErr.message);
      }
    }

    await client.query(
      `UPDATE applications
       SET decision = $1, internal_note = $2, applicant_message = $3, status = 'decided', decided_at = now()
       WHERE id = $4`,
      [decision, cleanInternalNote || null, cleanApplicantMessage || null, id]
    );
    await client.query('COMMIT');

    return res.status(200).json({ id, status: 'decided' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('send-decision error:', err.message);
    return res.status(500).json({ error: 'Unable to send decision.' });
  } finally {
    client.release();
  }
};
