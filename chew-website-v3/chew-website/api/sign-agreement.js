// /api/sign-agreement.js
//
// Records an applicant's e-signature on the Client Services Agreement
// (see legal/client-services-agreement.md) for a specific program tier.
// Reached from sign-agreement.html, which sits between select-program.html
// and entry-fee checkout — create-program-checkout-session.js requires a
// matching row here before it will create a Stripe session.
//
// POST /api/sign-agreement { token, tier, signedName }

const { query } = require('../lib/db');
const { getProgram } = require('../lib/programs');
const { AGREEMENT_VERSION } = require('../lib/agreement');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  // TEMPORARY: one-time migration trampoline, piggybacked on this function's
  // existing slot so we don't add a 13th file past the Vercel Hobby plan's
  // per-deployment function limit. Remove this block once run.
  if (req.method === 'GET' && req.query && req.query.migrate === process.env.ADMIN_SECRET) {
    try {
      await query(`CREATE TABLE IF NOT EXISTS agreement_signatures (
        id                 SERIAL PRIMARY KEY,
        application_id     INTEGER NOT NULL REFERENCES applications (id),
        tier               TEXT NOT NULL CHECK (tier IN ('infrastructure', 'executive', 'membership')),
        signed_name        TEXT NOT NULL,
        agreement_version  TEXT NOT NULL,
        ip_address         TEXT,
        user_agent         TEXT,
        signed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_agreement_signatures_application ON agreement_signatures (application_id)`);
      await query(`ALTER TABLE program_purchases ADD COLUMN IF NOT EXISTS agreement_signature_id INTEGER REFERENCES agreement_signatures (id)`);
      return res.status(200).json({ migrated: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, tier, signedName } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });
    if (!signedName || !String(signedName).trim()) {
      return res.status(400).json({ error: 'Please type your full legal name to sign.' });
    }

    try {
      getProgram(tier);
    } catch {
      return res.status(400).json({ error: 'Invalid program tier.' });
    }

    const appResult = await query(
      `SELECT id, full_name, decision FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    if (!['ACCEPT', 'ACCEPT_WITH_CONDITIONS'].includes(application.decision)) {
      return res.status(403).json({ error: 'This application has not been accepted.' });
    }

    if (normalizeName(signedName) !== normalizeName(application.full_name)) {
      return res.status(400).json({
        error: `Please type your name exactly as it appears on your application: ${application.full_name}`,
      });
    }

    const ipAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
    const userAgent = req.headers['user-agent'] || null;

    const insertResult = await query(
      `INSERT INTO agreement_signatures (application_id, tier, signed_name, agreement_version, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [application.id, tier, String(signedName).trim(), AGREEMENT_VERSION, ipAddress, userAgent]
    );

    return res.status(200).json({ signatureId: insertResult.rows[0].id });
  } catch (err) {
    console.error('sign-agreement error:', err.message);
    return res.status(500).json({ error: 'Unable to record signature.' });
  }
};
