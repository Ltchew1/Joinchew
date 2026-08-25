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
    `SELECT p.*, l.eligibility_notes, l.prerequisite_notes, l.documents_needed, l.priority,
            j.label AS jurisdiction_label
     FROM capability_provider_links l
     JOIN network_providers p ON p.id = l.provider_id
     LEFT JOIN jurisdictions j ON j.id = p.jurisdiction_id
     WHERE l.capability_id = $1 AND p.status = 'active' AND p.is_ready = TRUE
     ORDER BY l.priority ASC`,
    [capability.id]
  );

  const providers = providersResult.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    relationshipClassification: row.relationship_classification,
    entityType: row.entity_type,
    disclosureText: row.disclosure_text,
    jurisdictionId: row.jurisdiction_id,
    jurisdictionLabel: row.jurisdiction_label,
    licensingNotes: row.licensing_notes,
    contactMethod: row.contact_method,
    dataSharingNotes: row.data_sharing_notes,
    eligibilityNotes: row.eligibility_notes,
    prerequisiteNotes: row.prerequisite_notes,
    documentsNeeded: row.documents_needed || [],
  }));

  return {
    capability: {
      slug: capability.slug,
      name: capability.name,
      category: capability.category,
      description: capability.description,
    },
    available: providers.length > 0,
    providers,
  };
}

// One row per capability, with a live count of active/ready providers —
// used by the public "Opportunity Radar" (see script.js) to show every
// capability's real state in a single query instead of N round trips.
// Deliberately has no "expiring" or "newly opened" concept: nothing in
// this schema tracks a deadline or freshness window for a capability,
// and inventing one to make the radar feel more dynamic would be
// exactly the fabricated urgency every directive in this build has
// forbidden. availability here is always a live COUNT, never cached or
// guessed.
async function getCapabilityOverview() {
  const result = await query(
    `SELECT c.id, c.slug, c.name, c.category,
            COUNT(p.id) FILTER (WHERE p.status = 'active' AND p.is_ready = TRUE) AS active_provider_count
     FROM capabilities c
     LEFT JOIN capability_provider_links l ON l.capability_id = c.id
     LEFT JOIN network_providers p ON p.id = l.provider_id
     GROUP BY c.id, c.slug, c.name, c.category
     ORDER BY c.id ASC`
  );
  return result.rows.map((row) => {
    const activeProviderCount = parseInt(row.active_provider_count, 10) || 0;
    return {
      slug: row.slug,
      name: row.name,
      category: row.category,
      activeProviderCount,
      available: activeProviderCount > 0,
    };
  });
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

module.exports = { getCapabilities, getRoutingRecommendation, getCapabilityOverview, recordRoutingEvent, recordConsent };
