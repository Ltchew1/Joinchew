// /api/sign-agreement.js
//
// Records an applicant's e-signature on the Client Services Agreement for
// a specific program tier. The agreement text itself lives in
// lib/agreementText.js — see that file's header for why. Reached from
// sign-agreement.html, which sits between select-program.html and
// entry-fee checkout — create-program-checkout-session.js requires a
// matching row here before it will create a Stripe session, and also
// verifies the commercial terms snapshotted below still match live
// pricing before it will do so (see that file).
//
// POST /api/sign-agreement { token, tier, signedName, agreedToTerms }
//
// agreedToTerms must be exactly `true`. The affirmative checkbox in
// sign-agreement.html was previously enforced only by the browser
// (`required` on the input) — nothing server-side confirmed a real
// consent fact was ever sent. This makes that a validated, stored part of
// the evidence record instead of an assumption the UI didn't tamper.

const crypto = require('crypto');
const { query } = require('../lib/db');
const { getProgram } = require('../lib/programs');
const { AGREEMENT_VERSION } = require('../lib/agreement');
const { renderAgreementHtml } = require('../lib/agreementText');

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, tier, signedName, agreedToTerms } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing application token.' });
    if (!signedName || !String(signedName).trim()) {
      return res.status(400).json({ error: 'Please type your full legal name to sign.' });
    }
    if (agreedToTerms !== true) {
      return res.status(400).json({ error: 'Please confirm you have read and agree to the Client Services Agreement.' });
    }

    let program;
    try {
      program = getProgram(tier);
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

    // Deterministic proof of the literal text this signature was shown —
    // independent of whether AGREEMENT_VERSION got bumped correctly.
    const contentHash = crypto.createHash('sha256').update(`${AGREEMENT_VERSION}:${renderAgreementHtml(tier)}`).digest('hex');

    const insertResult = await query(
      `INSERT INTO agreement_signatures (
         application_id, tier, signed_name, agreement_version, ip_address, user_agent,
         agreement_read_and_accepted, agreement_content_hash,
         entry_amount_cents_at_signing, full_fee_cents_at_signing,
         remainder_amount_cents_at_signing, recurring_amount_cents_at_signing
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        application.id, tier, String(signedName).trim(), AGREEMENT_VERSION, ipAddress, userAgent,
        true, contentHash,
        program.entryAmountCents, program.fullFeeCents || null,
        program.hasRemainder ? program.remainderAmountCents : null, program.recurringAmountCents || null,
      ]
    );

    return res.status(200).json({ signatureId: insertResult.rows[0].id });
  } catch (err) {
    console.error('sign-agreement error:', err.message);
    return res.status(500).json({ error: 'Unable to record signature.' });
  }
};
