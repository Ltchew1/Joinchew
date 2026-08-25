// lib/pathEngine.js
//
// Resolves a business type + jurisdiction into an ordered set of real
// path requirements, plus a coverage status describing how complete that
// answer actually is. Never invents a requirement: if nothing is seeded
// for a given business type / jurisdiction combination, this returns an
// empty steps array with coverage GENERAL_GUIDANCE, and the caller is
// responsible for showing general educational content — not fabricated
// specifics.

const { query } = require('./db');

const COVERAGE = {
  VERIFIED: 'VERIFIED',                 // every relevant step matches the requested jurisdiction (state-level or narrower)
  PARTIAL: 'PARTIAL',                   // some real steps found, but coverage falls short of what was requested
  GENERAL_GUIDANCE: 'GENERAL_GUIDANCE', // nothing seeded for this business type at all
};

async function getBusinessPath({ businessTypeSlug, state, county, city }) {
  const requestedJurisdiction = { state: state || null, county: county || null, city: city || null };

  const businessTypeResult = await query('SELECT * FROM business_types WHERE slug = $1', [businessTypeSlug]);
  const businessType = businessTypeResult.rows[0];
  if (!businessType) {
    return { businessType: null, requestedJurisdiction, coverage: COVERAGE.GENERAL_GUIDANCE, steps: [] };
  }

  const requirementsResult = await query(
    `SELECT pr.*, j.state, j.county, j.city, j.label AS jurisdiction_label,
            s.name AS source_name, s.authority_level, s.url AS source_url
     FROM path_requirements pr
     JOIN jurisdictions j ON j.id = pr.jurisdiction_id
     JOIN sources s ON s.id = pr.source_id
     WHERE pr.business_type_id = $1
     ORDER BY pr.sequence_order ASC`,
    [businessType.id]
  );

  // A requirement is relevant if it's national (applies everywhere) or if
  // its jurisdiction matches the requested state. County/city-level
  // matching isn't implemented yet because no county/city rows exist in
  // the seed data — see PATH_ENGINE.md before extending this.
  const relevant = requirementsResult.rows.filter((row) => {
    const isNational = !row.state && !row.county && !row.city;
    const matchesState = Boolean(state) && row.state === state && !row.county && !row.city;
    return isNational || matchesState;
  });

  const hasStateSpecific = relevant.some((row) => row.state === state);
  const requestedLocalScope = Boolean(county || city);

  let coverage;
  if (relevant.length === 0) {
    coverage = COVERAGE.GENERAL_GUIDANCE;
  } else if (hasStateSpecific && !requestedLocalScope) {
    coverage = COVERAGE.VERIFIED;
  } else {
    coverage = COVERAGE.PARTIAL;
  }

  const steps = relevant.map((row) => ({
    id: row.id,
    sequenceOrder: row.sequence_order,
    name: row.name,
    requirementType: row.requirement_type,
    issuingAuthority: row.issuing_authority,
    costCents: row.cost_cents,
    costNotes: row.cost_notes,
    renewalPeriod: row.renewal_period,
    dependsOnId: row.depends_on_id,
    documentsNeeded: row.documents_needed || [],
    officialActionUrl: row.official_action_url,
    notes: row.notes,
    verificationStatus: row.verification_status,
    lastVerifiedAt: row.last_verified_at,
    source: { name: row.source_name, authorityLevel: row.authority_level, url: row.source_url },
    jurisdictionLabel: row.jurisdiction_label,
  }));

  return {
    businessType: { slug: businessType.slug, name: businessType.name, category: businessType.category },
    requestedJurisdiction,
    coverage,
    steps,
  };
}

module.exports = { getBusinessPath, COVERAGE };
