// /api/send-reminders.js
//
// Triggered automatically by Vercel Cron (see vercel.json) once per hour.
// Finds confirmed bookings happening in the next 24 hours that haven't had
// a reminder sent yet, sends one, and marks them so they don't get a
// duplicate.

const { query } = require('../lib/db');
const { sendReminderEmail } = require('../lib/email');

module.exports = async (req, res) => {
  // Vercel Cron sends a GET request with this header — reject anything else
  // to stop this endpoint being triggered by a random visitor.
  const isCron = req.headers['x-vercel-cron'] || req.query.manual === process.env.CRON_MANUAL_SECRET;
  if (!isCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await query(
      `SELECT id, tier, client_name, client_email, slot_start
       FROM bookings
       WHERE status = 'confirmed'
         AND reminder_sent = FALSE
         AND slot_start BETWEEN now() AND (now() + interval '24 hours')`
    );

    let sent = 0;
    for (const row of result.rows) {
      const slotLabel = new Date(row.slot_start).toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });

      try {
        await sendReminderEmail({
          to: row.client_email,
          name: row.client_name,
          tier: row.tier,
          slotLabel,
        });
        await query(`UPDATE bookings SET reminder_sent = TRUE WHERE id = $1`, [row.id]);
        sent++;
      } catch (emailErr) {
        console.error(`Failed to send reminder for booking ${row.id}:`, emailErr.message);
      }
    }

    return res.status(200).json({ checked: result.rows.length, sent });
  } catch (err) {
    console.error('send-reminders error:', err.message);
    return res.status(500).json({ error: 'Reminder job failed.' });
  }
};
