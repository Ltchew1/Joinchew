// /api/log-session-delivered.js
//
// Records one delivered 1:1 session against a paid engagement — the
// execution ledger locked in the Pre-Portal Master Specification.
// Deliberately a real per-event row (date, admin identity), not a bare
// incrementing counter: "sessions delivered" is always COUNT(*) against
// program_purchase_sessions, never a separately-stored number that could
// drift from the actual event history.
//
// Capped at the purchase's real tier ceiling (lib/programs.js
// PROGRAMS[tier].sessionCount) — session 3 of a 2-session Focused
// Builder engagement is rejected outright, not merely hidden in the UI.
// A duplicate session_number for the same purchase is rejected by a
// UNIQUE constraint (program_purchase_sessions.purchase_id,
// session_number), not just application-level discipline.
//
// POST /api/log-session-delivered
//   Authorization: Bearer <Clerk session token>
//   { purchaseId, sessionNumber, deliveredAt (optional, defaults to now), notes (optional) }

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

  const { purchaseId, sessionNumber, deliveredAt, notes } = req.body || {};
  if (!purchaseId) return res.status(400).json({ error: 'Missing purchaseId.' });
  const num = Number(sessionNumber);
  if (!Number.isInteger(num) || num < 1) {
    return res.status(400).json({ error: 'sessionNumber must be a positive integer.' });
  }

  try {
    const purchaseResult = await query(`SELECT id, tier FROM program_purchases WHERE id = $1`, [purchaseId]);
    const purchase = purchaseResult.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Purchase not found.' });

    const program = PROGRAMS[purchase.tier];
    const ceiling = program && program.sessionCount;
    if (!ceiling) {
      return res.status(400).json({ error: `This engagement's tier (${purchase.tier}) has no session ceiling to log against.` });
    }
    if (num > ceiling) {
      return res.status(400).json({ error: `Session ${num} exceeds this engagement's ${ceiling}-session limit.` });
    }

    const cleanNotes = notes ? String(notes).trim().slice(0, 2000) : null;
    const insertResult = await query(
      `INSERT INTO program_purchase_sessions (purchase_id, session_number, delivered_at, logged_by, notes)
       VALUES ($1, $2, COALESCE($3, now()), $4, $5)
       ON CONFLICT (purchase_id, session_number) DO NOTHING
       RETURNING id, delivered_at`,
      [purchaseId, num, deliveredAt || null, adminId, cleanNotes]
    );

    if (!insertResult.rows[0]) {
      return res.status(409).json({ error: `Session ${num} has already been logged for this engagement.`, code: 'DUPLICATE_SESSION' });
    }

    const countResult = await query(`SELECT count(*)::int c FROM program_purchase_sessions WHERE purchase_id = $1`, [purchaseId]);

    return res.status(200).json({
      logged: true,
      sessionId: insertResult.rows[0].id,
      sessionsDelivered: countResult.rows[0].c,
      sessionCeiling: ceiling,
    });
  } catch (err) {
    console.error('log-session-delivered error:', err.message);
    return res.status(500).json({ error: 'Unable to log session.' });
  }
};
