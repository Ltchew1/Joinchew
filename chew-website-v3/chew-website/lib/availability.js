// lib/availability.js
//
// Defines CHEW's weekly available time blocks and generates concrete open
// slots for the next N days, filtering out anything already booked.
//
// This is intentionally a simple fixed weekly template for v1 — no admin UI
// to change availability yet (that's an Admin Dashboard / Phase 4 feature).
// To change hours, edit WEEKLY_TEMPLATE below and redeploy.

const { query } = require('./db');

// 0 = Sunday ... 6 = Saturday. Times are in the SITE_TIMEZONE below.
// Availability: 12:00 PM – 5:00 PM, Monday through Friday only.
// Last slot starts at 4:00 PM so even a longer session finishes by 5:00 PM.
const WEEKLY_TEMPLATE = {
  1: ['12:00', '13:00', '14:00', '15:00', '16:00'], // Monday
  2: ['12:00', '13:00', '14:00', '15:00', '16:00'], // Tuesday
  3: ['12:00', '13:00', '14:00', '15:00', '16:00'], // Wednesday
  4: ['12:00', '13:00', '14:00', '15:00', '16:00'], // Thursday
  5: ['12:00', '13:00', '14:00', '15:00', '16:00'], // Friday
};

const SITE_TIMEZONE = 'America/New_York'; // adjust to your actual business timezone
const DAYS_AHEAD = 14;

function getSlotsForDate(date) {
  const dayOfWeek = date.getDay();
  const times = WEEKLY_TEMPLATE[dayOfWeek] || [];
  return times.map((t) => {
    const [hh, mm] = t.split(':').map(Number);
    const slot = new Date(date);
    slot.setHours(hh, mm, 0, 0);
    return slot;
  });
}

async function getAvailableSlots() {
  const now = new Date();
  const candidateSlots = [];

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    for (const slot of getSlotsForDate(date)) {
      if (slot > now) candidateSlots.push(slot);
    }
  }

  // Exclude anything already held (pending, not expired) or confirmed
  const result = await query(
    `SELECT slot_start FROM bookings
     WHERE status = 'confirmed'
        OR (status = 'pending' AND expires_at > now())`
  );
  const takenTimes = new Set(result.rows.map((r) => new Date(r.slot_start).getTime()));

  return candidateSlots
    .filter((slot) => !takenTimes.has(slot.getTime()))
    .map((slot) => ({
      iso: slot.toISOString(),
      label: slot.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: SITE_TIMEZONE,
        timeZoneName: 'short',
      }),
    }));
}

module.exports = { getAvailableSlots, SITE_TIMEZONE, WEEKLY_TEMPLATE };
