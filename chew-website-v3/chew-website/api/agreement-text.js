// /api/agreement-text.js
//
// Public, read-only. Serves the canonical Client Services Agreement body
// for sign-agreement.html to render, sourced from lib/agreementText.js —
// the single place this text now lives (see that file's header comment).
// No token required: the text itself isn't member-specific, same posture
// as api/deal-sheet.js.
//
// GET /api/agreement-text?tier=<infrastructure|executive|membership>

const { getAgreementSections, KEY_TERMS, TIER_LABELS, AGREEMENT_VERSION } = require('../lib/agreementText');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tier } = req.query || {};
  if (!tier || !TIER_LABELS[tier]) {
    return res.status(400).json({ error: 'Missing or invalid tier.' });
  }

  try {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({
      version: AGREEMENT_VERSION,
      tier,
      tierLabel: TIER_LABELS[tier],
      sections: getAgreementSections(tier),
      keyTerms: KEY_TERMS,
    });
  } catch (err) {
    console.error('agreement-text error:', err.message);
    return res.status(500).json({ error: 'Unable to load agreement text.' });
  }
};
