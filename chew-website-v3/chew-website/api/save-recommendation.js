// /api/save-recommendation.js
//
// The CHEW Scope Builder's write endpoint: an authenticated admin reviews
// an accepted applicant's Starting Position and approves the engagement
// level(s) the client will be allowed to purchase — see
// lib/admin-auth.js for the auth boundary, engagement_recommendations /
// recommendation_conditions in db/schema.sql for the record this writes.
//
// POST /api/save-recommendation
//   Authorization: Bearer <Clerk session token>
//   {
//     applicationId, action: 'draft' | 'send',
//     primaryTier, alternativeTier (optional),
//     focusAreas: [slug, ...],
//     clientFacingReason, clientFacingSummary (optional),
//     alternativeTradeoff (required iff alternativeTier is set),
//     conditions: [{ text, blocking }, ...] (optional)
//   }
//
// action 'draft' never notifies the applicant and is never visible to
// them (api/recommendation.js only ever returns a status='sent' row).
// action 'send' finalizes the content, marks any PRIOR sent version for
// this application 'superseded', and triggers the "Your CHEW
// Recommendation Is Ready" email — a materially different event from
// admissions ACCEPT, sent separately (see api/send-decision.js).
//
// Repeated saves against the SAME still-draft recommendation update it in
// place (one row per application while in draft — see
// idx_engagement_recommendations_one_draft) rather than accumulating
// abandoned draft versions. Once a version is sent, editing it again
// always creates a NEW version instead of mutating sent content, so a
// client's signature stays bound to what they actually saw (see
// api/sign-agreement.js).

const { query, getPool } = require('../lib/db');
const { ONE_TIME_TIERS, PROGRAMS } = require('../lib/programs');
const { isValidFocusAreaList } = require('../lib/focusAreas');
const { requireAdmin } = require('../lib/admin-auth');
const { sendRecommendationReadyEmail } = require('../lib/email');

function validateConditions(conditions) {
  if (conditions == null) return [];
  if (!Array.isArray(conditions)) return null;
  const cleaned = [];
  for (const c of conditions) {
    const text = c && String(c.text || '').trim();
    if (!text) return null;
    cleaned.push({ text: text.slice(0, 1000), blocking: c.blocking !== false });
  }
  return cleaned;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const {
    applicationId, action, primaryTier, alternativeTier, focusAreas,
    clientFacingReason, clientFacingSummary, alternativeTradeoff, conditions,
  } = req.body || {};

  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId.' });
  if (!['draft', 'send'].includes(action)) return res.status(400).json({ error: "action must be 'draft' or 'send'." });
  if (!ONE_TIME_TIERS.includes(primaryTier)) return res.status(400).json({ error: 'Invalid primary engagement tier.' });
  if (alternativeTier != null) {
    if (!ONE_TIME_TIERS.includes(alternativeTier)) return res.status(400).json({ error: 'Invalid alternative engagement tier.' });
    if (alternativeTier === primaryTier) return res.status(400).json({ error: 'Alternative must differ from the primary recommendation.' });
    if (!alternativeTradeoff || !String(alternativeTradeoff).trim()) {
      return res.status(400).json({ error: 'A human-approved alternative tradeoff explanation is required when an alternative is offered.' });
    }
  }
  if (!isValidFocusAreaList(focusAreas)) return res.status(400).json({ error: 'Select at least one valid CHEW Focus Area.' });
  if (!clientFacingReason || !String(clientFacingReason).trim()) {
    return res.status(400).json({ error: 'A client-facing reason ("why this fits") is required.' });
  }
  const cleanedConditions = validateConditions(conditions);
  if (cleanedConditions === null) return res.status(400).json({ error: 'Each condition needs non-empty text.' });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const appResult = await client.query(
      `SELECT id, decision FROM applications WHERE id = $1 FOR UPDATE`,
      [applicationId]
    );
    const application = appResult.rows[0];
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Application not found.' });
    }
    if (!['ACCEPT', 'ACCEPT_WITH_CONDITIONS'].includes(application.decision)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'A recommendation can only be built for an accepted application.' });
    }

    const draftResult = await client.query(
      `SELECT id, version FROM engagement_recommendations WHERE application_id = $1 AND status = 'draft' FOR UPDATE`,
      [applicationId]
    );
    const existingDraft = draftResult.rows[0] || null;

    let recommendationId;
    let version;
    const newStatus = action === 'send' ? 'sent' : 'draft';

    if (existingDraft) {
      recommendationId = existingDraft.id;
      version = existingDraft.version;
      await client.query(
        `UPDATE engagement_recommendations
         SET status = $1, primary_tier = $2, alternative_tier = $3, focus_areas = $4,
             client_facing_reason = $5, client_facing_summary = $6, alternative_tradeoff = $7,
             sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END
         WHERE id = $8`,
        [newStatus, primaryTier, alternativeTier || null, JSON.stringify(focusAreas),
          clientFacingReason, clientFacingSummary || null, alternativeTradeoff || null, recommendationId]
      );
      await client.query(`DELETE FROM recommendation_conditions WHERE recommendation_id = $1`, [recommendationId]);
    } else {
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM engagement_recommendations WHERE application_id = $1`,
        [applicationId]
      );
      version = versionResult.rows[0].next_version;
      const insertResult = await client.query(
        `INSERT INTO engagement_recommendations (
           application_id, version, status, primary_tier, alternative_tier, focus_areas,
           client_facing_reason, client_facing_summary, alternative_tradeoff, created_by, sent_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $3 = 'sent' THEN now() ELSE NULL END)
         RETURNING id`,
        [applicationId, version, newStatus, primaryTier, alternativeTier || null, JSON.stringify(focusAreas),
          clientFacingReason, clientFacingSummary || null, alternativeTradeoff || null, adminId]
      );
      recommendationId = insertResult.rows[0].id;
    }

    for (const c of cleanedConditions) {
      await client.query(
        `INSERT INTO recommendation_conditions (recommendation_id, condition_text, blocking) VALUES ($1, $2, $3)`,
        [recommendationId, c.text, c.blocking]
      );
    }

    let supersededPriorVersion = false;
    if (action === 'send') {
      const supersedeResult = await client.query(
        `UPDATE engagement_recommendations
         SET status = 'superseded', superseded_at = now()
         WHERE application_id = $1 AND status = 'sent' AND id <> $2`,
        [applicationId, recommendationId]
      );
      supersededPriorVersion = supersedeResult.rowCount > 0;
    }

    await client.query('COMMIT');

    if (action === 'send') {
      try {
        const appInfo = await query(`SELECT full_name, email, access_token FROM applications WHERE id = $1`, [applicationId]);
        await sendRecommendationReadyEmail({
          to: appInfo.rows[0].email,
          name: appInfo.rows[0].full_name,
          engagementLabel: PROGRAMS[primaryTier].label,
          clientFacingReason,
          recommendationUrl: `${process.env.SITE_URL}/recommendation.html?token=${encodeURIComponent(appInfo.rows[0].access_token)}`,
        });
      } catch (emailErr) {
        console.error(`RECOMMENDATION_READY_EMAIL_FAILED recommendation=${recommendationId}:`, emailErr.message);
      }
    }

    return res.status(200).json({ recommendationId, version, status: newStatus, supersededPriorVersion });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('save-recommendation error:', err.message);
    return res.status(500).json({ error: 'Unable to save recommendation.' });
  } finally {
    client.release();
  }
};
