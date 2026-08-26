// scenario-engine.js
//
// Shared, pure, DOM-free scenario-state logic reused by both the Unlock
// Room and the Simulation Room (see FEATURE_FLAGS.md — "Do not build
// another isolated sandbox implementation"). Nothing here touches the
// network or the database; every function is a pure transform over data
// already fetched from /api/intelligence-demo.
//
// deriveState's "first unmet by sequence_order becomes current focus"
// rule is not a guess or a reimplementation risk: it is lib/intelligenceEngine.js's
// own documented behavior, verbatim ("the first transition_requirements
// row (by sequence_order) that current_state_facts doesn't satisfy" —
// see that file's header comment and computeRecommendation's evaluation
// loop). The rule has no hidden inputs beyond real sequence order and a
// met/unmet flag per requirement, so recomputing it client-side against a
// hypothetical resolved-map matches what the server would compute for
// that same hypothetical fact set.
(function (global) {
  'use strict';

  function deriveState(requirementSequence, resolvedMap) {
    var total = requirementSequence.length;
    var resolvedCount = 0;
    var chosenKey = null;
    var perRequirement = requirementSequence.map(function (tile) {
      var met = !!resolvedMap[tile.key];
      if (met) resolvedCount++;
      if (!met && chosenKey === null) chosenKey = tile.key;
      return { key: tile.key, label: tile.label, met: met, capabilitySlug: tile.capabilitySlug || null, capabilityName: tile.capabilityName || null };
    });
    return { total: total, resolvedCount: resolvedCount, chosenKey: chosenKey, perRequirement: perRequirement };
  }

  function computeRequirementDelta(before, after) {
    var newlyResolvedKeys = [];
    var newlyUnresolvedKeys = [];
    after.perRequirement.forEach(function (a, i) {
      var b = before.perRequirement[i];
      if (a.met && !b.met) newlyResolvedKeys.push(a.key);
      if (!a.met && b.met) newlyUnresolvedKeys.push(a.key);
    });
    return {
      resolvedCountBefore: before.resolvedCount,
      resolvedCountAfter: after.resolvedCount,
      total: before.total,
      chosenKeyBefore: before.chosenKey,
      chosenKeyAfter: after.chosenKey,
      chosenKeyChanged: before.chosenKey !== after.chosenKey,
      newlyResolvedKeys: newlyResolvedKeys,
      newlyUnresolvedKeys: newlyUnresolvedKeys,
    };
  }

  // Capability coverage over requirements that actually link to a real
  // capability in this scenario. Returns null — not zero — when nothing
  // links, so the caller can render an honest "not modeled" state instead
  // of a fabricated percentage.
  function deriveCapabilityCoverage(requirementSequence, availabilityMap) {
    var linked = requirementSequence.filter(function (t) { return !!t.capabilitySlug; });
    if (!linked.length) return null;
    var availableCount = linked.filter(function (t) { return !!availabilityMap[t.capabilitySlug]; }).length;
    return {
      linkedCount: linked.length,
      availableCount: availableCount,
      coveragePct: Math.round((availableCount / linked.length) * 100),
      linkedSlugs: linked.map(function (t) { return t.capabilitySlug; }),
    };
  }

  function computeCapabilityDelta(before, after) {
    if (!before && !after) return null;
    return { before: before, after: after };
  }

  function cloneResolvedMap(requirementSequence, basedOnFacts) {
    var map = {};
    requirementSequence.forEach(function (t) {
      map[t.key] = !!(basedOnFacts[t.key] && basedOnFacts[t.key].met);
    });
    return map;
  }

  function cloneAvailabilityMap(capabilityOverview) {
    var map = {};
    (capabilityOverview || []).forEach(function (c) { map[c.slug] = !!c.available; });
    return map;
  }

  var ChewScenarioEngine = {
    deriveState: deriveState,
    computeRequirementDelta: computeRequirementDelta,
    deriveCapabilityCoverage: deriveCapabilityCoverage,
    computeCapabilityDelta: computeCapabilityDelta,
    cloneResolvedMap: cloneResolvedMap,
    cloneAvailabilityMap: cloneAvailabilityMap,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChewScenarioEngine;
  } else {
    global.ChewScenarioEngine = ChewScenarioEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
