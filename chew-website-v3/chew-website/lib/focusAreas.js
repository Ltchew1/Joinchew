// lib/focusAreas.js
//
// The locked client-facing Focus Area taxonomy — service/scope
// descriptors an admin attaches to a recommendation to explain WHAT CHEW
// will focus on inside the approved engagement. These are NOT separate
// products, NOT à-la-carte charges, and NOT the same vocabulary as the
// site's public "Worlds" (world-home.html etc.) — they may connect to
// Worlds internally, but a client should never need to know a World name
// to understand what CHEW is working on with them. No arbitrary custom
// strings: every focus_areas entry stored on engagement_recommendations
// must be one of these 9 slugs — see isValidFocusArea() below, which is
// the single point every write path (api/save-recommendation.js) must
// call before persisting.

const FOCUS_AREAS = {
  financial_organization: 'FINANCIAL ORGANIZATION',
  credit_intelligence: 'CREDIT INTELLIGENCE',
  cash_flow_banking: 'CASH FLOW & BANKING',
  business_foundation: 'BUSINESS FOUNDATION',
  funding_readiness: 'FUNDING READINESS',
  income_opportunity: 'INCOME & OPPORTUNITY',
  property_readiness: 'PROPERTY READINESS',
  protection_risk: 'PROTECTION & RISK',
  decision_sequencing: 'DECISION SEQUENCING',
};

const FOCUS_AREA_SLUGS = Object.keys(FOCUS_AREAS);

function isValidFocusArea(slug) {
  return Object.prototype.hasOwnProperty.call(FOCUS_AREAS, slug);
}

// Validates a whole array at once — used by api/save-recommendation.js so
// a single bad slug rejects the entire write rather than silently
// dropping it (silently dropping one would mean the admin's saved
// recommendation quietly shows fewer focus areas than they selected).
function isValidFocusAreaList(list) {
  return Array.isArray(list) && list.length > 0 && list.every(isValidFocusArea);
}

module.exports = { FOCUS_AREAS, FOCUS_AREA_SLUGS, isValidFocusArea, isValidFocusAreaList };
