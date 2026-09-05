// /api/log-document-review.js
//
// Records one completed document review event against a paid engagement
// — same execution-ledger doctrine as api/log-session-delivered.js,
// capped at PROGRAMS[tier].documentReviewEvents, one row per event, no
// bare counter.
//
// POST /api/log-document-review
//   Authorization: Bearer <Clerk session token>
//   { purchaseId, reviewNumber, reviewedAt (optional), documentsReviewed (optional), notes (optional) }

const { query } = require('../lib/db');
const { requireAdmin } = require('../lib/admin-auth');
const { PROGRAMS } = require('../lib/programs');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const { purchaseId, reviewNumber, reviewedAt, documentsReviewed, notes } = req.body || {};
  if (!purchaseId) return res.status(400).json({ error: 'Missing purchaseId.' });
  const num = Number(reviewNumber);
  if (!Number.isInteger(num) || num < 1) {
    return res.status(400).json({ error: 'reviewNumber must be a positive integer.' });
  }

  try {
    const purchaseResult = await query(`SELECT id, tier FROM program_purchases WHERE id = $1`, [purchaseId]);
    const purchase = purchaseResult.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    const program = PROGRAMS[purchase.tier];
    const ceiling = program && program.documentReviewEvents;
    if (!ceiling) {
      return res.status(400).json({ error: `This engagement's tier (${purchase.tier}) has no document-review ceiling to log against.` });
    }
    if (num > ceiling) {
      return res.status(400).json({ error: `Review ${num} exceeds this engagement's ${ceiling} document-review-event limit.` });
    }

    const cleanNotes = notes ? String(notes).trim().slice(0, 2000) : null;
    const cleanDocs = documentsReviewed ? String(documentsReviewed).trim().slice(0, 2000) : null;
    const insertResult = await query(
      `INSERT INTO program_purchase_document_reviews (purchase_id, review_number, reviewed_at, logged_by, documents_reviewed, notes)
       VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6)
       ON CONFLICT (purchase_id, review_number) DO NOTHING
       RETURNING id, reviewed_at`,
      [purchaseId, num, reviewedAt || null, adminId, cleanDocs, cleanNotes]
    );

    if (!insertResult.rows[0]) {
      return res.status(409).json({ error: `Review ${num} has already been logged for this engagement.`, code: 'DUPLICATE_REVIEW' });
    }

    const countResult = await query(`SELECT count(*)::int c FROM program_purchase_document_reviews WHERE purchase_id = $1`, [purchaseId]);

    return res.status(200).json({
      logged: true,
      reviewId: insertResult.rows[0].id,
      documentReviewsUsed: countResult.rows[0].c,
      documentReviewCeiling: ceiling,
    });
  } catch (err) {
    console.error('log-document-review error:', err.message);
    return res.status(500).json({ error: 'Unable to log document review.' });
  }
};
