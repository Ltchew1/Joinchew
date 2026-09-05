// /api/mark-service-complete.js
//
// Marks a paid engagement's service delivery as complete — the fact that
// everything downstream (Continuity, the Membership graduate-fee waiver,
// the eventual portal's "engagement complete" state) depends on. Per the
// locked design decision (Pre-Portal Master Specification): this is a
// deliberate, one-way admin action.
//
//   - No undo endpoint exists, and none should be added. A genuine
//     correction is an exceptional operator/database action, not a
//     routine admin workflow.
//   - Idempotent: a repeat call for an already-complete purchase is a
//     safe no-op — it returns the existing service_completed_at /
//     continuity_ends_at rather than erroring or recomputing them, so it
//     can never create a second Continuity window or double-send the
//     Continuity notice.
//   - continuity_ends_at is computed ONCE, at completion time
//     (service_completed_at + 30 days), and stored — not recomputed on
//     every read — so it survives any later change to a tier's terms.
//   - The client-facing Continuity notice follows the claim-before-send
//     doctrine via continuity_notice_customer_notified_at, separate from
//     service_completed_at itself: an email-provider failure never
//     blocks completion from being real, and is independently retryable
//     by calling this same endpoint again (which will see the purchase
//     is already complete, skip re-computing anything, and retry only
//     the notice).
//
// POST /api/mark-service-complete
//   Authorization: Bearer <Clerk session token>
//   { purchaseId }

const { query, getPool, claimAndSend } = require('../lib/db');
const { requireAdmin } = require('../lib/admin-auth');
const { sendContinuityStartedEmail } = require('../lib/email');

const CONTINUITY_DAYS = 30;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const { purchaseId } = req.body || {};
  if (!purchaseId) return res.status(400).json({ error: 'Missing purchaseId.' });

  const client = await getPool().connect();
  let alreadyComplete = false;
  let serviceCompletedAt;
  let continuityEndsAt;
  let tier;
  let clientEmail;
  let clientName;

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT id, tier, client_name, client_email, service_completed_at, continuity_ends_at
       FROM program_purchases WHERE id = $1 FOR UPDATE`,
      [purchaseId]
    );
    const purchase = result.rows[0];
    if (!purchase) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    tier = purchase.tier;
    clientEmail = purchase.client_email;
    clientName = purchase.client_name;

    if (purchase.service_completed_at) {
      // Idempotent no-op: completion already happened. Do not recompute
      // continuity_ends_at, do not touch anything -- just report the
      // existing state so a repeat admin click is harmless.
      alreadyComplete = true;
      serviceCompletedAt = purchase.service_completed_at;
      continuityEndsAt = purchase.continuity_ends_at;
      await client.query('ROLLBACK');
    } else {
      const updateResult = await client.query(
        `UPDATE program_purchases
         SET service_completed_at = now(), continuity_ends_at = now() + interval '${CONTINUITY_DAYS} days'
         WHERE id = $1
         RETURNING service_completed_at, continuity_ends_at`,
        [purchaseId]
      );
      serviceCompletedAt = updateResult.rows[0].service_completed_at;
      continuityEndsAt = updateResult.rows[0].continuity_ends_at;
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('mark-service-complete error:', err.message);
    return res.status(500).json({ error: 'Unable to mark service complete.' });
  } finally {
    client.release();
  }

  // Notification is claimed and sent independently of the state change
  // above -- reached on both the fresh-completion path and the
  // already-complete retry path, so a prior email failure is always
  // retryable by calling this endpoint again.
  try {
    await claimAndSend(
      'program_purchases', 'id', purchaseId, 'continuity_notice_customer_notified_at',
      () => sendContinuityStartedEmail({ to: clientEmail, name: clientName, tier, continuityEndsAt })
    );
  } catch (emailErr) {
    console.error(`CONTINUITY_NOTICE_FAILED purchase=${purchaseId}:`, emailErr.message);
  }

  return res.status(200).json({
    purchaseId: Number(purchaseId),
    alreadyComplete,
    serviceCompletedAt,
    continuityEndsAt,
  });
};
