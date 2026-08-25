// lib/capabilityGraph.js
//
// Resolves a capability need (e.g. "insurance_risk_review") into the real,
// active, ready provider(s) for it — never a fabricated referral. If no
// provider is seeded, active, and ready for a capability, this returns an
// empty providers array. It never returns a 'coming_soon' or 'hidden'
// provider, regardless of who asks — that filter happens in SQL, not in
// the caller, so a crafted request can't leak an unfinished provider.
//
// See CAPABILITY_NETWORK.md for what's real vs. architectural-only.

const { query } = require('./db');

async function getCapabilities() {
  const result = await query('SELECT * FROM capabilities ORDER BY id ASC');
  return result.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
  }));
}

async function getRoutingRecommendation({ capabilitySlug }) {
  const capabilityResult = await query('SELECT * FROM capabilities WHERE slug = $1', [capabilitySlug]);
  const capability = capabilityResult.rows[0];
  if (!capability) {
    return { capability: null, available: false, providers: [] };
  }

  const providersResult = await query(
    `SELECT p.*, l.eligibility_notes, l.prerequisite_notes, l.documents_needed, l.priority
     FROM capability_provider_links l
     JOIN network_providers p ON p.id = l.provider_id
     WHERE l.capability_id = $1 AND p.status = 'active' AND p.is_ready = TRUE
     ORDER BY l.priority ASC`,
    [capability.id]
  );

  const providers = providersResult.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    relationshipClassification: row.relationship_classification,
    disclosureText: row.disclosure_text,
    jurisdictionId: row.jurisdiction_id,
    licensingNotes: row.licensing_notes,
    contactMethod: row.contact_method,
    dataSharingNotes: row.data_sharing_notes,
    eligibilityNotes: row.eligibility_notes,
    prerequisiteNotes: row.prerequisite_notes,
    documentsNeeded: row.documents_needed || [],
  }));

  return {
    capability: { slug: capability.slug, name: capability.name, category: capability.category },
    available: providers.length > 0,
    providers,
  };
}

async function recordRoutingEvent({ capabilitySlug, providerId, applicationId, outcome, notes }) {
  const capabilityResult = await query('SELECT id FROM capabilities WHERE slug = $1', [capabilitySlug]);
  const capabilityId = capabilityResult.rows[0] ? capabilityResult.rows[0].id : null;
  const result = await query(
    `INSERT INTO routing_events (capability_id, provider_id, application_id, outcome, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [capabilityId, providerId || null, applicationId || null, outcome, notes || null]
  );
  return result.rows[0].id;
}

async function recordConsent({ applicationId, capabilitySlug, providerId, dataSharedSummary, ipAddress, userAgent }) {
  const capabilityResult = await query('SELECT id FROM capabilities WHERE slug = $1', [capabilitySlug]);
  const capability = capabilityResult.rows[0];
  if (!capability) throw new Error(`Unknown capability: ${capabilitySlug}`);

  const result = await query(
    `INSERT INTO routing_consents (application_id, capability_id, provider_id, data_shared_summary, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [applicationId || null, capability.id, providerId, dataSharedSummary, ipAddress || null, userAgent || null]
  );
  return result.rows[0].id;
}

module.exports = { getCapabilities, getRoutingRecommendation, recordRoutingEvent, recordConsent };
