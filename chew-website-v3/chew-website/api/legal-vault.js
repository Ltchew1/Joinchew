// /api/legal-vault.js
//
// Read-only Legal & Permissions Vault data, scoped to one application via
// its access_token (the same real per-application identity already used by
// select-program.html, sign-agreement.html, and api/application-summary.js
// — there is no separate member-login system in this codebase to check
// against, so this reuses the real mechanism that already exists rather
// than inventing a new one).
//
// Joins the two tables that already carry real evidence for this
// application — agreement_signatures and program_purchases — and maps them
// into the Permission Ledger state model (ACTIVE / NOT_AUTHORIZED /
// REVOKED / EXPIRED / REQUIRES_REAUTHORIZATION). Never returns a fabricated
// ACTIVE state: a permission category with no backing row/column comes back
// NOT_AUTHORIZED with an honest reason, not invented data.
//
// Explicitly excludes ip_address and user_agent from agreement_signatures —
// those are evidence-layer fields for CHEW's internal proof records, not
// ordinary member-facing UI, per the no-drift directive.
//
// GET /api/legal-vault?token=<applications.access_token>

const { query } = require('../lib/db');

const TIER_LABELS = { infrastructure: 'Infrastructure Program', executive: 'Executive Advisory', membership: 'Membership' };

function centsToDisplay(cents) {
  if (cents == null) return null;
  return cents / 100;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Missing token.' });

  try {
    const appResult = await query(
      `SELECT id, full_name, email, decision FROM applications WHERE access_token = $1`,
      [token]
    );
    const application = appResult.rows[0];
    if (!application) return res.status(404).json({ error: 'This page requires a valid link from your CHEW email.' });

    const [signaturesResult, purchasesResult] = await Promise.all([
      query(
        `SELECT id, tier, signed_name, agreement_version, signed_at
         FROM agreement_signatures WHERE application_id = $1 ORDER BY signed_at DESC`,
        [application.id]
      ),
      query(
        `SELECT id, tier, entry_amount_cents, entry_paid_at, remainder_amount_cents,
                remainder_paid_at, remainder_payment_method, membership_status, status, created_at
         FROM program_purchases WHERE application_id = $1 ORDER BY created_at DESC`,
        [application.id]
      ),
    ]);

    const agreements = signaturesResult.rows.map((row) => ({
      id: row.id,
      tier: row.tier,
      tierLabel: TIER_LABELS[row.tier] || row.tier,
      agreementLabel: 'CHEW LLC Client Services Agreement',
      agreementVersion: row.agreement_version,
      signedAt: row.signed_at,
      status: 'ACTIVE',
    }));

    const billing = purchasesResult.rows.map((row) => {
      let status = 'NOT_AUTHORIZED';
      if (row.membership_status === 'cancelled') status = 'REVOKED';
      else if (row.entry_paid_at) status = 'ACTIVE';
      return {
        id: row.id,
        tier: row.tier,
        tierLabel: TIER_LABELS[row.tier] || row.tier,
        status,
        entryAmount: centsToDisplay(row.entry_amount_cents),
        entryPaidAt: row.entry_paid_at,
        remainderAmount: centsToDisplay(row.remainder_amount_cents),
        remainderPaidAt: row.remainder_paid_at,
        remainderPaymentMethod: row.remainder_payment_method,
        membershipStatus: row.membership_status,
        purchaseStatus: row.status,
      };
    });

    const hasAnyAgreement = agreements.length > 0;
    const hasActiveBilling = billing.some((b) => b.status === 'ACTIVE');

    // Permission Ledger — every entry is derived from the real rows above.
    // Categories with no backing data anywhere in this codebase are marked
    // NOT_AUTHORIZED with an honest, specific reason rather than omitted or
    // guessed at.
    const permissions = [
      {
        key: 'agreement_acceptance',
        label: 'Agreement Acceptance',
        status: hasAnyAgreement ? 'ACTIVE' : 'NOT_AUTHORIZED',
        detail: hasAnyAgreement
          ? 'You have signed the CHEW Client Services Agreement.'
          : 'No agreement has been signed on this application yet.',
      },
      {
        key: 'electronic_signature',
        label: 'Electronic Signature Consent',
        status: hasAnyAgreement ? 'ACTIVE' : 'NOT_AUTHORIZED',
        detail: hasAnyAgreement
          ? 'You consented to sign electronically under Florida’s Uniform Electronic Transaction Act.'
          : 'This permission has not been requested.',
      },
      {
        key: 'billing_authorization',
        label: 'Billing Authorization',
        status: hasActiveBilling ? 'ACTIVE' : (billing.some((b) => b.status === 'REVOKED') ? 'REVOKED' : 'NOT_AUTHORIZED'),
        detail: hasActiveBilling
          ? 'CHEW is authorized to process the payment(s) shown below.'
          : 'No payment has been authorized yet.',
      },
      {
        key: 'marketing_communications',
        label: 'Marketing Communications',
        status: 'NOT_AUTHORIZED',
        detail: 'This permission has not been requested.',
      },
      {
        key: 'credit_information_access',
        label: 'Credit Information Access',
        status: 'NOT_AUTHORIZED',
        detail: 'This permission has not been requested. CHEW does not access your credit information directly.',
      },
      {
        key: 'data_connection',
        label: 'Data / Account Connections',
        status: 'NOT_AUTHORIZED',
        detail: 'No external account or data connection exists on this application.',
      },
      {
        key: 'document_assistance',
        label: 'Document Assistance',
        status: 'NOT_AUTHORIZED',
        detail: 'This permission has not been requested.',
      },
    ];

    return res.status(200).json({
      fullName: application.full_name,
      email: application.email,
      agreements,
      billing,
      permissions,
      disclosures: [
        'CHEW does not sign, send, or submit letters or documents on your behalf, under any circumstance.',
        'CHEW does not promise or guarantee any funding, approval, credit score change, or removal of information.',
      ],
    });
  } catch (err) {
    console.error('legal-vault error:', err.message);
    return res.status(500).json({ error: 'Unable to load your Legal & Permissions record.' });
  }
};
