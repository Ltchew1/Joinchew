// /api/admin-applications.js
//
// Admissions review queue. Authenticated via a real Clerk admin session
// (see lib/admin-auth.js) — the query-string shared-secret bridge this
// endpoint used before is gone from the primary path; a disabled-in-
// production legacy fallback remains only for local dev, see
// lib/admin-auth.js's legacySecretAuthorized().
// Requires CLERK_SECRET_KEY, ADMIN_CLERK_USER_ID, and DATABASE_URL set in
// Vercel environment variables.
//
// GET /api/admin-applications
//   Authorization: Bearer <Clerk session token>

const { query } = require('../lib/db');
const { requireAdmin, legacySecretAuthorized } = require('../lib/admin-auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!legacySecretAuthorized(req.query.secret)) {
    const adminId = await requireAdmin(req, res);
    if (!adminId) return; // requireAdmin already wrote the 401/403/503 response
  }

  try {
    // Journey stage is derived (no new applications columns needed for
    // it) from three real signals already written by other endpoints in
    // this same flow: applications.status/decision (submitted -> scored
    // -> decided -> ACCEPT[ED]), agreement_signatures (program selected +
    // agreement signed happen together in the current UI — select-
    // program.html doesn't persist a choice on its own, sign-agreement.js
    // is the first write), and program_purchases (entry_paid_at / status
    // for payment-complete / enrolled). Aggregated with a LATERAL join so
    // one application row stays one row even with multiple purchase
    // attempts. Read-only — nothing here writes to those tables.
    const result = await query(
      `SELECT a.id, a.full_name, a.email, a.phone, a.answers,
              a.ai_score, a.ai_dimension_scores, a.ai_recommendation, a.ai_conditions,
              a.ai_rationale, a.ai_one_flag, a.ai_one_strength, a.ai_error,
              a.status, a.decision, a.internal_note, a.applicant_message, a.decided_at, a.created_at,
              sig.tier AS agreement_tier, sig.signed_at AS agreement_signed_at,
              pp.tier AS purchase_tier, pp.entry_paid_at, pp.status AS purchase_status,
              pp.membership_status
       FROM applications a
       LEFT JOIN LATERAL (
         SELECT tier, signed_at FROM agreement_signatures
         WHERE application_id = a.id ORDER BY signed_at DESC LIMIT 1
       ) sig ON true
       LEFT JOIN LATERAL (
         SELECT tier, entry_paid_at, status, membership_status FROM program_purchases
         WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1
       ) pp ON true
       ORDER BY (a.status = 'decided') ASC, a.created_at DESC`
    );
    return res.status(200).json({ applications: result.rows });
  } catch (err) {
    console.error('admin-applications error:', err.message);
    return res.status(500).json({ error: 'Unable to load applications.' });
  }
};
