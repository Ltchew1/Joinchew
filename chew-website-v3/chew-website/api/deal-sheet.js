// /api/deal-sheet.js
//
// Public, read-only. Returns the real entry-fee pricing/billing/scope for a
// program tier, sourced from lib/agreementRegistry.js (which itself reads
// lib/programs.js — the same object api/create-program-checkout-session.js
// uses to build the actual Stripe line items). No member-specific data;
// nothing here requires a token or touches the database. Used by
// sign-agreement.html's Deal Sheet step and select-program.html's pricing
// cards, so both read the same numbers the checkout session will actually
// charge instead of carrying a second hardcoded copy.
//
// GET /api/deal-sheet?tier=<infrastructure|executive|membership>

const { getDealSheetData } = require('../lib/agreementRegistry');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tier } = req.query || {};
  if (!tier) return res.status(400).json({ error: 'Missing tier.' });

  try {
    const data = getDealSheetData(tier);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid program tier.' });
  }
};
