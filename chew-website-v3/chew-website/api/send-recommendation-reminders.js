// /api/send-recommendation-reminders.js
//
// Three honest, single-shot follow-up nudges for the CHEW Recommendation
// Engine, same manual/cron-trigger pattern as api/send-membership-reminders.js:
//   A. recommendation sent, not viewed after ~24 hours
//   B. recommendation viewed, no engagement selected after ~3 days
//   C. engagement selected, not yet signed after ~7 days
// Each is claimed via its own *_reminder_sent_at column on
// engagement_recommendations (db/schema.sql) before sending, so a cron
// re-run — or two overlapping runs — never double-sends. No countdown,
// no scarcity, no invented deadline is ever computed or shown; the
// windows below only gate whether a plain, honest reminder goes out at
// all, matching the client-facing copy in lib/email.js.
//
// Wire this up to Vercel Cron once the site is confirmed live (or trigger
// manually via ?manual=<CRON_MANUAL_SECRET>).
//
// Requires: DATABASE_URL, RESEND_API_KEY, FROM_EMAIL, SITE_URL

const { query } = require('../lib/db');
const {
  sendRecommendationNotViewedReminderEmail,
  sendChooseEngagementReminderEmail,
  sendSignAgreementReminderEmail,
} = require('../lib/email');

async function claimAndSend(recommendationId, column, sendFn) {
  const claim = await query(
    `UPDATE engagement_recommendations SET ${column} = now() WHERE id = $1 AND ${column} IS NULL RETURNING id`,
    [recommendationId]
  );
  if (claim.rowCount === 0) return false; // already sent (or claimed by a concurrent run)
  await sendFn();
  return true;
}

module.exports = async (req, res) => {
  const isCron = req.headers['x-vercel-cron'] || req.query.manual === process.env.CRON_MANUAL_SECRET;
  if (!isCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const counts = { notViewed: 0, noSelection: 0, notSigned: 0 };

  try {
    const notViewed = await query(
      `SELECT er.id, a.full_name, a.email, a.access_token
       FROM engagement_recommendations er
       JOIN applications a ON a.id = er.application_id
       WHERE er.status = 'sent' AND er.viewed_at IS NULL
         AND er.not_viewed_reminder_sent_at IS NULL
         AND er.sent_at <= now() - interval '24 hours'`
    );
    for (const row of notViewed.rows) {
      try {
        const sent = await claimAndSend(row.id, 'not_viewed_reminder_sent_at', () => sendRecommendationNotViewedReminderEmail({
          to: row.email, name: row.full_name,
          recommendationUrl: `${process.env.SITE_URL}/recommendation.html?token=${encodeURIComponent(row.access_token)}`,
        }));
        if (sent) counts.notViewed++;
      } catch (err) {
        console.error(`Failed to send not-viewed reminder for recommendation ${row.id}:`, err.message);
      }
    }

    const noSelection = await query(
      `SELECT er.id, a.full_name, a.email, a.access_token
       FROM engagement_recommendations er
       JOIN applications a ON a.id = er.application_id
       LEFT JOIN engagement_selections sel ON sel.recommendation_id = er.id AND sel.superseded_at IS NULL
       WHERE er.status = 'sent' AND er.viewed_at IS NOT NULL AND sel.id IS NULL
         AND er.no_selection_reminder_sent_at IS NULL
         AND er.viewed_at <= now() - interval '3 days'`
    );
    for (const row of noSelection.rows) {
      try {
        const sent = await claimAndSend(row.id, 'no_selection_reminder_sent_at', () => sendChooseEngagementReminderEmail({
          to: row.email, name: row.full_name,
          recommendationUrl: `${process.env.SITE_URL}/recommendation.html?token=${encodeURIComponent(row.access_token)}`,
        }));
        if (sent) counts.noSelection++;
      } catch (err) {
        console.error(`Failed to send no-selection reminder for recommendation ${row.id}:`, err.message);
      }
    }

    const notSigned = await query(
      `SELECT er.id, a.full_name, a.email, a.access_token
       FROM engagement_recommendations er
       JOIN applications a ON a.id = er.application_id
       JOIN engagement_selections sel ON sel.recommendation_id = er.id AND sel.superseded_at IS NULL
       LEFT JOIN agreement_signatures sig ON sig.recommendation_id = er.id
       WHERE er.status = 'sent' AND sig.id IS NULL
         AND er.not_signed_reminder_sent_at IS NULL
         AND sel.selected_at <= now() - interval '7 days'`
    );
    for (const row of notSigned.rows) {
      try {
        const sent = await claimAndSend(row.id, 'not_signed_reminder_sent_at', () => sendSignAgreementReminderEmail({
          to: row.email, name: row.full_name,
          signAgreementUrl: `${process.env.SITE_URL}/sign-agreement.html?token=${encodeURIComponent(row.access_token)}`,
        }));
        if (sent) counts.notSigned++;
      } catch (err) {
        console.error(`Failed to send not-signed reminder for recommendation ${row.id}:`, err.message);
      }
    }

    return res.status(200).json({
      checked: notViewed.rows.length + noSelection.rows.length + notSigned.rows.length,
      sent: counts,
    });
  } catch (err) {
    console.error('send-recommendation-reminders error:', err.message);
    return res.status(500).json({ error: 'Reminder job failed.' });
  }
};
