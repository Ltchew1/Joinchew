// /api/leverage-model.js
//
// Internal-only surface for the CHEW Hidden Leverage Foundation (see
// lib/leverageModel.js, db/schema.sql's "Hidden Leverage Foundation"
// section, and FEATURE_FLAGS.md). Gated 'internal' in feature_flags —
// deliberately unreachable (404) unless the flag is later flipped to at
// least 'preview', same pattern as api/scenario-model.js.
//
// This never accepts a caller-supplied subjectId. Every request is
// pinned to ILLUSTRATIVE_SUBJECT_ID — the one seeded intel_subjects row
// used everywhere else on this site. There is no real member identity
// system yet (ARCHITECTURE.md Gap 1), and this file must never be
// wired to a real person until that exists — see leverage_items'
// own CHECK constraint, which blocks a 'member' row at the database
// level regardless of what this file does.
//
// GET  /api/leverage-model?action=discover   — runs findHiddenLeverage(), persists/re-verifies, returns all items found
// GET  /api/leverage-model?action=listActive — the suppressed view (excludes already_activated/stale/unavailable)
// GET  /api/leverage-model?action=listAll
// GET  /api/leverage-model?id=5
// POST /api/leverage-model { action: 'activate', id }

const leverageModel = require('../lib/leverageModel');
const { isFeatureActive } = require('../lib/featureFlags');

const ILLUSTRATIVE_SUBJECT_ID = 1;

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await isFeatureActive('hidden_leverage_discovery'))) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    if (req.method === 'GET') {
      const { action, id } = req.query || {};

      if (id) {
        const idNum = parseInt(id, 10);
        if (!Number.isInteger(idNum)) return res.status(400).json({ error: 'id must be an integer.' });
        const item = await leverageModel.getLeverageItem(idNum);
        return res.status(200).json({ item });
      }

      if (action === 'listActive') {
        const items = await leverageModel.listActiveLeverage(ILLUSTRATIVE_SUBJECT_ID);
        return res.status(200).json({ items });
      }
      if (action === 'listAll') {
        const items = await leverageModel.listAllLeverage(ILLUSTRATIVE_SUBJECT_ID);
        return res.status(200).json({ items });
      }
      // default GET action: run discovery
      const items = await leverageModel.findHiddenLeverage({ subjectId: ILLUSTRATIVE_SUBJECT_ID });
      return res.status(200).json({ items });
    }

    // POST
    const { action, id } = req.body || {};
    if (action !== 'activate') {
      return res.status(400).json({ error: 'action must be "activate".' });
    }
    const idNum = parseInt(id, 10);
    if (!Number.isInteger(idNum)) return res.status(400).json({ error: 'id (integer) is required.' });
    const item = await leverageModel.markLeverageItemActivated(idNum);
    return res.status(200).json({ item });
  } catch (err) {
    if (err.message === 'Leverage item not found.') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('is not yet supported by any real detector')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('leverage-model error:', err.message);
    return res.status(500).json({ error: 'Unable to process leverage request.' });
  }
};
