// /api/available-slots.js
//
// Returns open time slots for the next 14 days, based on the weekly
// availability template in lib/availability.js, minus anything already
// booked or currently on hold. Requires DATABASE_URL.

const { getAvailableSlots } = require('../lib/availability');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const slots = await getAvailableSlots();
    return res.status(200).json({ slots });
  } catch (err) {
    console.error('Available slots error:', err.message);
    return res.status(500).json({ error: 'Unable to load available times.' });
  }
};
