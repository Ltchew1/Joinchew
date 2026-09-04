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
// POST /api/sign-agreement { token, tier, signedName, agreedToTerms, paymentPlanType }
//
// agreedToTerms must be exactly `true`. The affirmative checkbox in
// sign-agreement.html was previously enforced only by the browser
// (`required` on the input) — nothing server-side confirmed a real
// consent fact was ever sent. This makes that a validated, stored part of
// the evidence record instead of an assumption the UI didn't tamper.
//
// paymentPlanType is required for one-time engagements ('pay_in_full' or
// 'monthly') and ignored for membership, which keeps its own separate
// entry-fee-plus-recurring-subscription model. The exact amounts for
// whichever plan is chosen are snapshotted onto the signature the same
// way commercial terms already are — see *_at_signing columns below —
// so api/create-program-checkout-session.js can refuse to charge
// anything the client didn't actually see and sign for.
//
// Signature durability: recording the signature and notifying anyone
// about it are different facts, same doctrine as api/stripe-webhook.js's
// payment/notification split. A signature commits durably first; the
// owner and client emails are then each independently claimed and sent,
// and a failure on either one never un-signs the agreement or blocks the
// response to the client — see claimAndSendAgreementNotification below.
//
// Idempotency: two near-simultaneous submissions for the same
// application+tier (a double-click, a browser retry) are serialized with
// a Postgres advisory lock and resolve to the SAME signature row rather
// than creating two, as long as the agreement version hasn't changed
// since the existing one was signed — a real amendment still gets a
// fresh signature, this only collapses duplicates of the identical event.

const crypto = require('crypto');
const { query, getPool } = require('../lib/db');
const { getProgram, isOneTimeTier } = require('../lib/programs');
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

// Same claim/send/mark-on-success-only shape as stripe-webhook.js's
// claimAndSendNotification, scoped to one signature row instead of one
// purchase row. Kept local rather than shared across files — these are
// unrelated events (a signature vs. a payment) that happen to use the
// same sound Postgres pattern, not a reason to couple the two modules.
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { token, tier, signedName, agreedToTerms, paymentPlanType } = req.body || {};
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

    // Membership is not a first-time engagement choice (locked doctrine: CHEW
    // Membership is graduates-only, reached after an engagement completes and
    // its 30-day Continuity period, via a separate affirmative opt-in). This
    // is the ONLY path that currently reaches signature creation for any
    // tier, so blocking it here is what actually enforces the rule —
    // select-program.html simply no longer offers the card. A future
    // graduate-enrollment path would need its own route that bypasses this
    // check with real graduate verification; nothing does today.
    if (tier === 'membership') {
      return res.status(403).json({ error: 'Membership is available to CHEW graduates after their engagement completes, not as a first-time engagement. Please choose Focused Builder, Infrastructure, Advanced Infrastructure, or Executive Advisory.' });
    }

    const oneTime = isOneTimeTier(tier);
    if (oneTime && !['pay_in_full', 'monthly'].includes(paymentPlanType)) {
      return res.status(400).json({ error: 'Please choose Pay in Full or the Monthly Plan.' });
    }

    let totalContractAmount = null;
    let initialPaymentAmount = null;
    let installmentAmount = null;
    let installmentCount = null;
    const planType = oneTime ? paymentPlanType : null;
    if (oneTime) {
      totalContractAmount = program.totalCents;
      if (paymentPlanType === 'pay_in_full') {
        initialPaymentAmount = program.totalCents;
      } else {
        initialPaymentAmount = program.monthly.initialCents;
        installmentAmount = program.monthly.installmentCents;
        installmentCount = program.monthly.installmentCount;
      }
    }

    const appResult = await query(
      `SELECT id, full_name, email, phone, decision FROM applications WHERE access_token = $1`,
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
    const agreementHtml = renderAgreementHtml(tier);
    // Deterministic proof of the literal text this signature was shown —
    // independent of whether AGREEMENT_VERSION got bumped correctly.
    const contentHash = crypto.createHash('sha256').update(`${AGREEMENT_VERSION}:${agreementHtml}`).digest('hex');

    // Find-or-create under an advisory lock scoped to this application+
    // tier, so two near-simultaneous requests serialize instead of both
    // inserting. The lock is transaction-scoped (auto-released on
    // COMMIT/ROLLBACK) and needs no row to already exist, unlike SELECT
    // ... FOR UPDATE — there may be nothing to lock yet on a first sign.
    const lockClient = await getPool().connect();
    let signatureId;
    let signedAt;
    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sign-agreement:${application.id}:${tier}`]);

      // Matching on payment_plan_type too (via IS NOT DISTINCT FROM, since
      // it's null for membership): a different payment plan is a
      // materially different commitment and deserves its own signature,
      // not a silent reuse of one for a different set of amounts.
      const existing = await lockClient.query(
        `SELECT id, signed_at FROM agreement_signatures
         WHERE application_id = $1 AND tier = $2 AND agreement_version = $3
           AND payment_plan_type_at_signing IS NOT DISTINCT FROM $4
         ORDER BY signed_at DESC LIMIT 1`,
        [application.id, tier, AGREEMENT_VERSION, planType]
      );

      if (existing.rows[0]) {
        signatureId = existing.rows[0].id;
        signedAt = existing.rows[0].signed_at;
      } else {
        const insertResult = await lockClient.query(
          `INSERT INTO agreement_signatures (
             application_id, tier, signed_name, agreement_version, ip_address, user_agent,
             agreement_read_and_accepted, agreement_content_hash, agreement_snapshot_html,
             payment_plan_type_at_signing, total_contract_amount_at_signing,
             initial_payment_amount_at_signing, installment_amount_at_signing, installment_count_at_signing
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id, signed_at`,
          [
            application.id, tier, String(signedName).trim(), AGREEMENT_VERSION, ipAddress, userAgent,
            true, contentHash, agreementHtml,
            planType, totalContractAmount, initialPaymentAmount, installmentAmount, installmentCount,
          ]
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

    // The signature is durably committed at this point. Owner/client
    // notifications are best-effort and independently retryable — never
    // allowed to change the response the client gets for a successful sign.
    try {
      const sent = await claimAndSendAgreementNotification(signatureId, 'owner', () => sendOwnerSignedAgreementNotice({
        fullName: application.full_name,
        email: application.email,
        phone: application.phone,
        program: TIER_LABELS[tier],
        agreementVersion: AGREEMENT_VERSION,
        signedAt,
        agreementHtml,
      }));
      if (!sent) console.log(`Sign-agreement: owner notification for signature ${signatureId} already sent — skipping.`);
    } catch (emailErr) {
      console.error(`OWNER_SIGNED_AGREEMENT_NOTIFICATION_FAILED signature=${signatureId}:`, emailErr.message);
    }

    try {
      const sent = await claimAndSendAgreementNotification(signatureId, 'client', () => sendClientSignedAgreementCopyEmail({
        to: application.email,
        name: application.full_name,
        program: TIER_LABELS[tier],
        agreementVersion: AGREEMENT_VERSION,
        signedAt,
        agreementHtml,
      }));
      if (!sent) console.log(`Sign-agreement: client notification for signature ${signatureId} already sent — skipping.`);
    } catch (emailErr) {
      console.error(`CLIENT_SIGNED_AGREEMENT_NOTIFICATION_FAILED signature=${signatureId}:`, emailErr.message);
    }

    return res.status(200).json({ signatureId });
  } catch (err) {
    console.error('sign-agreement error:', err.message);
    return res.status(500).json({ error: 'Unable to record signature.' });
  }
};
