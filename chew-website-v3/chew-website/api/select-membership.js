// /api/select-membership.js
//
// The Membership front door specified in the Pre-Portal Master
// Specification: before this endpoint, Membership had no live
// client-facing entry point anywhere in this codebase — its Stripe
// checkout branch existed and was correctly gated, but nothing ever
// called it. This is that missing call site, gated the way Membership's
// own doctrine requires: post-engagement, graduate-only, never automatic.
//
// Membership cannot go through api/sign-agreement.js — that endpoint's
// gate structurally requires an active engagement_recommendations row,
// and engagement_recommendations can never have tier='membership' (DB
// CHECK constraint). This endpoint is Membership's own signing gate,
// mirroring sign-agreement.js's evidence/idempotency pattern but keyed
// on graduate status instead of an approved recommendation:
//
//   graduate = EXISTS(a program_purchases row for this application with
//   service_completed_at set) — per the locked decision, ANY completed
//   CHEW engagement, ever, not just the most recent one. This is the same
//   query api/purchase-status.js exposes as `membershipEligible`.
//
// A non-graduate is rejected outright — Membership is not reachable at
// all until at least one engagement is complete, per the locked
// transition (Paid Engagement -> Service Completion -> Continuity Window
// -> Membership Offer). This is stricter than "fee waived vs not" -- it
// gates ACCESS to this endpoint, not just the price.
//
// On success, returns a signatureId exactly like api/sign-agreement.js
// does, so the client proceeds through the SAME, unmodified
// api/create-program-checkout-session.js — no parallel checkout/payment
// code, only a relaxed guard there (see that file's tier==='membership'
// branch) checking this same graduate fact.
//
// POST /api/select-membership { token, signedName, agreedToTerms }

const crypto = require('crypto');
const { query, getPool } = require('../lib/db');
const { getProgram } = require('../lib/programs');
const { AGREEMENT_VERSION } = require('../lib/agreement');
const { renderAgreementHtml, TIER_LABELS } = require('../lib/agreementText');
const { sendOwnerSignedAgreementNotice, sendClientSignedAgreementCopyEmail } = require('../lib/email');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same claim/send/mark-on-success-only shape as sign-agreement.js's local
// claimAndSendAgreementNotification -- kept local here too, per that
// file's own stated convention (unrelated modules that happen to share a
// sound pattern, not a reason to couple them).
async function claimAndSendAgreementNotification(signatureId, kind, sendFn) {
  const column = kind === 'owner' ? 'owner_agreement_notified_at' : 'client_agreement_notified_at';
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT owner_agreement_notified_at, client_agreement_notified_at
       FROM agreement_signatures WHERE id = $1 FOR UPDATE`,
      [signatureId]
    );
    const row = result.rows[0];
    if (!row || row[column]) {
      await client.query('ROLLBACK');
      return false;
    }

    await sendFn();

    await client.query(`UPDATE agreement_signatures SET ${column} = now() WHERE id = $1`, [signatureId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, signedName, agreedToTerms } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });
    if (!signedName || !String(signedName).trim()) {
      return res.status(400).json({ error: 'Please type your full legal name to sign.' });
    }
    if (agreedToTerms !== true) {
      return res.status(400).json({ error: 'Please confirm you have read and agree to the Membership terms.' });
    }

    const appResult = await query(
      `SELECT id, full_name, email, phone, decision FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    if (normalizeName(signedName) !== normalizeName(application.full_name)) {
      return res.status(400).json({
        error: `Please type your name exactly as it appears on your application: ${application.full_name}`,
      });
    }

    const graduateResult = await query(
      `SELECT EXISTS(
         SELECT 1 FROM program_purchases WHERE application_id = $1 AND service_completed_at IS NOT NULL
       ) AS graduate`,
      [application.id]
    );
    if (!graduateResult.rows[0].graduate) {
      return res.status(403).json({
        error: 'CHEW Membership becomes available after a paid engagement is complete. It is not available yet for this application.',
        code: 'MEMBERSHIP_NOT_YET_AVAILABLE',
      });
    }

    const tier = 'membership';
    const program = getProgram(tier);
    const ipAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
    const userAgent = req.headers['user-agent'] || null;
    const agreementHtml = renderAgreementHtml(tier);
    const contentHash = crypto.createHash('sha256').update(`${AGREEMENT_VERSION}:${agreementHtml}`).digest('hex');

    const lockClient = await getPool().connect();
    let signatureId;
    let signedAt;
    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`select-membership:${application.id}`]);

      const existing = await lockClient.query(
        `SELECT id, signed_at FROM agreement_signatures
         WHERE application_id = $1 AND tier = $2 AND agreement_version = $3
         ORDER BY signed_at DESC LIMIT 1`,
        [application.id, tier, AGREEMENT_VERSION]
      );

      if (existing.rows[0]) {
        signatureId = existing.rows[0].id;
        signedAt = existing.rows[0].signed_at;
      } else {
        const insertResult = await lockClient.query(
          `INSERT INTO agreement_signatures (
             application_id, tier, signed_name, agreement_version, ip_address, user_agent,
             agreement_read_and_accepted, agreement_content_hash, agreement_snapshot_html
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, signed_at`,
          [application.id, tier, String(signedName).trim(), AGREEMENT_VERSION, ipAddress, userAgent, true, contentHash, agreementHtml]
        );
        signatureId = insertResult.rows[0].id;
        signedAt = insertResult.rows[0].signed_at;
      }
      await lockClient.query('COMMIT');
    } catch (err) {
      await lockClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      lockClient.release();
    }

    try {
      const sent = await claimAndSendAgreementNotification(signatureId, 'owner', () => sendOwnerSignedAgreementNotice({
        fullName: application.full_name, email: application.email, phone: application.phone,
        program: TIER_LABELS[tier], agreementVersion: AGREEMENT_VERSION, signedAt, agreementHtml,
      }));
      if (!sent) console.log(`select-membership: owner notification for signature ${signatureId} already sent — skipping.`);
    } catch (emailErr) {
      console.error(`OWNER_MEMBERSHIP_SIGNED_NOTIFICATION_FAILED signature=${signatureId}:`, emailErr.message);
    }

    try {
      const sent = await claimAndSendAgreementNotification(signatureId, 'client', () => sendClientSignedAgreementCopyEmail({
        to: application.email, name: application.full_name,
        program: TIER_LABELS[tier], agreementVersion: AGREEMENT_VERSION, signedAt, agreementHtml,
      }));
      if (!sent) console.log(`select-membership: client notification for signature ${signatureId} already sent — skipping.`);
    } catch (emailErr) {
      console.error(`CLIENT_MEMBERSHIP_SIGNED_NOTIFICATION_FAILED signature=${signatureId}:`, emailErr.message);
    }

    // Reaching this point already required graduate status (checked
    // above), and that same graduate fact is the fee-waiver determination
    // (see lib/programs.js entryFeeWaivedForGraduates) — so the amount
    // shown here must match what api/create-program-checkout-session.js
    // will actually charge, not the tier's undiscounted list price.
    return res.status(200).json({
      signatureId, tier,
      entryAmountCents: program.entryFeeWaivedForGraduates ? 0 : program.entryAmountCents,
      entryFeeWaived: program.entryFeeWaivedForGraduates,
      recurringAmountCents: program.recurringAmountCents,
      trialPeriodDays: program.trialPeriodDays,
    });
  } catch (err) {
    console.error('select-membership error:', err.message);
    return res.status(500).json({ error: 'Unable to record Membership signature.' });
  }
};
