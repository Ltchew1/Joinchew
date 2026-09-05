// lib/graduateStatus.js
//
// The single canonical entry point for "is this application a CHEW
// graduate" — the fact that gates Membership access, waives its entry
// fee, drives my-engagement.html's eligibility banner, the admin
// Membership-eligible badge, and (per the Pre-Portal Master
// Specification) the eventual Portal entitlement. Per external review
// after the initial Pre-Portal implementation pass: this must be ONE
// definition enforced at the database level (see db/schema.sql's
// is_graduate() SQL function), not independently re-derived per call
// site — every caller here goes through the same function instead of
// writing its own EXISTS(...) copy that could quietly drift (e.g. some
// future code treating status = 'complete' or payment_status = 'paid'
// as equivalent to the actual locked doctrine: service_completed_at IS
// NOT NULL on any qualifying engagement, ever).

const { query } = require('./db');

async function isGraduate(applicationId) {
  const result = await query(`SELECT is_graduate($1) AS graduate`, [applicationId]);
  return result.rows[0].graduate;
}

module.exports = { isGraduate };
