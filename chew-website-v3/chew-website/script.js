// CHEW — shared site behavior

document.addEventListener('DOMContentLoaded', function () {
  // CHEW Activation: a brief, skippable opening sequence on the homepage
  // only, shown once per browser session. Pure opacity/transform CSS
  // animation (GPU-friendly), never blocks interaction, and is a no-op
  // instantly under prefers-reduced-motion or on a repeat visit this
  // session.
  var activation = document.getElementById('chew-activation');
  if (activation) {
    var activationReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var alreadyActivated = false;
    try { alreadyActivated = sessionStorage.getItem('chewActivated') === '1'; } catch (e) { /* private browsing, etc — treat as not activated */ }

    if (alreadyActivated || activationReduceMotion) {
      activation.hidden = true;
    } else {
      document.documentElement.style.overflow = 'hidden';
      var finishActivation = function () {
        if (activation.hidden) return;
        activation.classList.add('is-hidden');
        document.documentElement.style.overflow = '';
        try { sessionStorage.setItem('chewActivated', '1'); } catch (e) { /* ignore */ }
        setTimeout(function () { activation.hidden = true; }, 650);
      };
      activation.addEventListener('click', finishActivation);
      setTimeout(finishActivation, 2200);
    }
  }

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // The CHEW Life Map: 8 territories, 13 curated real relationship edges.
  // This is editorial content about how financial domains generally
  // relate to each other — the same class of claim the caption below it
  // already made ("not a map of your accounts") — never personalized,
  // never database-backed, never claiming to know anything about the
  // visitor. Selecting a territory illuminates only its real connections.
  var lifemapWrap = document.getElementById('lifemap-wrap');
  if (lifemapWrap) {
    var LIFEMAP_LABELS = {
      credit: 'Credit', capital: 'Capital', business: 'Business', property: 'Property',
      insurance: 'Insurance', assets: 'Assets', liquidity: 'Liquidity', ownership: 'Ownership',
    };
    var LIFEMAP_EDGES = [
      { a: 'credit', b: 'capital', reason: 'Your credit profile shapes what capital you can access, and at what cost.' },
      { a: 'credit', b: 'property', reason: 'Credit is usually the gating requirement standing between you and financing property.' },
      { a: 'credit', b: 'business', reason: 'Personal credit often backs early business moves before business credit exists on its own.' },
      { a: 'credit', b: 'liquidity', reason: 'When liquidity runs low, credit is frequently the bridge that gets used instead.' },
      { a: 'capital', b: 'business', reason: 'Capital funds the business moves that go on to generate income and equity.' },
      { a: 'capital', b: 'ownership', reason: 'Ownership stakes can themselves become a future source of capital.' },
      { a: 'business', b: 'assets', reason: 'A business becomes an asset in its own right, and it can acquire assets of its own.' },
      { a: 'business', b: 'insurance', reason: 'A business carries exposure that personal insurance was never built to cover.' },
      { a: 'property', b: 'ownership', reason: 'Property is one of the clearest, most durable forms of ownership CHEW tracks.' },
      { a: 'property', b: 'insurance', reason: 'Property creates real exposure — insurance is what protects it once it’s yours.' },
      { a: 'insurance', b: 'assets', reason: 'Assets worth building are worth protecting; insurance guards what’s already been built.' },
      { a: 'assets', b: 'liquidity', reason: 'Not everything you own is something you can use right now — CHEW tracks that gap.' },
      { a: 'ownership', b: 'assets', reason: 'Ownership and assets tend to grow together — one is usually a sign the other is too.' },
    ];

    var lifemapHint = document.getElementById('lifemap-hint');
    var lifemapDetail = document.getElementById('lifemap-detail');
    var lifemapReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var lifemapSelected = null;

    function lifemapEscapeHtml(str) {
      return String(str).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function lifemapConnectionsFor(territory) {
      return LIFEMAP_EDGES
        .filter(function (e) { return e.a === territory || e.b === territory; })
        .map(function (e) { return { other: e.a === territory ? e.b : e.a, reason: e.reason }; });
    }

    function lifemapClearState() {
      lifemapWrap.querySelectorAll('.lifemap-node, .lifemap-label').forEach(function (el) {
        el.classList.remove('is-selected', 'is-connected');
      });
      lifemapWrap.querySelectorAll('.lifemap-spoke, .lifemap-edge').forEach(function (el) {
        el.classList.remove('is-lit');
      });
      lifemapWrap.querySelectorAll('.lifemap-hit').forEach(function (el) {
        el.setAttribute('aria-pressed', 'false');
      });
    }

    function lifemapDeselect() {
      lifemapSelected = null;
      lifemapWrap.classList.remove('has-selection');
      lifemapClearState();
      lifemapDetail.hidden = true;
      lifemapDetail.innerHTML = '';
      if (lifemapHint) lifemapHint.style.opacity = '1';
    }

    function lifemapSelect(territory) {
      if (lifemapSelected === territory) { lifemapDeselect(); return; }
      lifemapSelected = territory;
      lifemapWrap.classList.add('has-selection');
      lifemapClearState();

      var connections = lifemapConnectionsFor(territory);
      var connectedSet = {};
      connections.forEach(function (c) { connectedSet[c.other] = true; });

      lifemapWrap.querySelectorAll('.lifemap-node[data-territory="' + territory + '"], .lifemap-label[data-territory="' + territory + '"]').forEach(function (el) {
        el.classList.add('is-selected');
      });
      Object.keys(connectedSet).forEach(function (t) {
        lifemapWrap.querySelectorAll('.lifemap-node[data-territory="' + t + '"], .lifemap-label[data-territory="' + t + '"]').forEach(function (el) {
          el.classList.add('is-connected');
        });
      });
      lifemapWrap.querySelectorAll('.lifemap-spoke[data-territory="' + territory + '"]').forEach(function (el) { el.classList.add('is-lit'); });
      Object.keys(connectedSet).forEach(function (t) {
        lifemapWrap.querySelectorAll('.lifemap-spoke[data-territory="' + t + '"]').forEach(function (el) { el.classList.add('is-lit'); });
      });
      lifemapWrap.querySelectorAll('.lifemap-edge').forEach(function (el) {
        var a = el.getAttribute('data-a'), b = el.getAttribute('data-b');
        if (a === territory || b === territory) el.classList.add('is-lit');
      });
      var hitBtn = lifemapWrap.querySelector('.lifemap-hit[data-territory="' + territory + '"]');
      if (hitBtn) hitBtn.setAttribute('aria-pressed', 'true');

      var html = '<span class="lifemap-detail-eyebrow">' + lifemapEscapeHtml(LIFEMAP_LABELS[territory]) + ' connects to</span>'
        + '<ul class="lifemap-detail-list">'
        + connections.map(function (c) {
          return '<li><strong>' + lifemapEscapeHtml(LIFEMAP_LABELS[c.other]) + '</strong> — ' + lifemapEscapeHtml(c.reason) + '</li>';
        }).join('')
        + '</ul>'
        + '<button type="button" class="lifemap-detail-close" id="lifemap-detail-close">Clear selection</button>';
      lifemapDetail.innerHTML = html;
      lifemapDetail.hidden = false;
      if (lifemapHint) lifemapHint.style.opacity = '0';

      var closeBtn = document.getElementById('lifemap-detail-close');
      if (closeBtn) closeBtn.addEventListener('click', lifemapDeselect);

      if (!lifemapReduceMotion) {
        lifemapDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    lifemapWrap.querySelectorAll('.lifemap-hit').forEach(function (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        lifemapSelect(btn.getAttribute('data-territory'));
      });
    });
  }

  // Scroll-reveal: fade/rise elements into view once, respecting reduced motion.
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length && 'IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  // Gentle parallax on the hero glow layers — restrained, scroll-linked, never bouncy.
  var parallaxEls = document.querySelectorAll('[data-parallax]');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (parallaxEls.length && !reduceMotion) {
    var ticking = false;
    var applyParallax = function () {
      var y = window.scrollY || window.pageYOffset;
      parallaxEls.forEach(function (el) {
        var speed = parseFloat(el.getAttribute('data-parallax')) || 0.12;
        el.style.transform = 'translateY(' + (y * speed).toFixed(1) + 'px)';
      });
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(applyParallax);
        ticking = true;
      }
    }, { passive: true });
  }

  // "What's Next" expansion cards: rendered entirely from the shared
  // feature-flag registry (/api/feature-flags), not hard-coded per page.
  // A card's badge reads "Coming Soon" while status is 'internal'/'locked'
  // and switches itself to "Explore" the moment status reaches
  // 'preview'/'beta'/'live' — no redesign needed. The <noscript> block in
  // the HTML covers no-JS/SEO with the same copy as a static fallback.
  var LOCK_ICON_SVG = '<svg class="lock-icon intelligence-pulse" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="var(--gold-light)" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="var(--gold-light)" stroke-width="1.6"/></svg>';

  var expansionGrid = document.getElementById('expansion-grid');
  if (expansionGrid) {
    fetch('/api/feature-flags')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.flags || !data.flags.length) return;
        expansionGrid.innerHTML = '';
        data.flags.forEach(function (feature, i) {
          var card = document.createElement('div');
          card.className = 'glass card coming-soon-card';
          card.setAttribute('data-reveal', '');
          card.style.setProperty('--reveal-delay', (i * 0.06).toFixed(2) + 's');

          var badgeText = feature.isAccessible ? 'Explore' : 'Coming Soon';
          var badgeClass = feature.isAccessible ? 'status-badge is-active' : 'status-badge';

          card.innerHTML = LOCK_ICON_SVG +
            '<h4></h4><p></p>' +
            '<span class="' + badgeClass + '"></span>';
          card.querySelector('h4').textContent = feature.title || '';
          card.querySelector('p').textContent = feature.description || '';
          card.querySelector('.status-badge').textContent = badgeText;

          expansionGrid.appendChild(card);
          card.classList.add('is-visible'); // already in view by the time data arrives; skip the reveal race
        });
        expansionGrid.removeAttribute('aria-busy');
      })
      .catch(function () { expansionGrid.removeAttribute('aria-busy'); /* <noscript> fallback covers this visually via CSS below */ });
  }

  // Forms are not yet connected to a backend, payment processor, or CRM.
  // This shows an honest status message instead of silently failing.
  var forms = document.querySelectorAll('form[data-form]');
  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('.form-status');
      if (!status) return;
      status.textContent = "Thanks — this form isn't connected to our systems yet. Please also email us directly at leroyt@chewllc.org until that's live.";
      status.classList.add('success', 'visible');
      status.setAttribute('tabindex', '-1');
      status.focus();
    });
  });

  // "Tell CHEW where you're trying to go" — a real, working call to
  // CHEW's intelligence engine (see ARCHITECTURE.md), run against a
  // fixed illustrative example, never the visitor's own data. Every
  // stage below is built directly from the API's real returned fields
  // — nothing here is a scripted/staged animation with invented content.
  var goalButtons = document.querySelectorAll('.goal-btn');
  if (goalButtons.length) {
    var statusEl = document.getElementById('reveal-status');
    var resultEl = document.getElementById('intelligence-reveal-result');
    var disclaimerEl = document.getElementById('reveal-disclaimer');
    var chainEl = document.getElementById('reveal-chain');

    function formatFactKey(key) {
      return key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str == null ? '' : String(str);
      return div.innerHTML;
    }

    function buildStateStage(basedOnFacts) {
      var keys = Object.keys(basedOnFacts);
      var html = '<span class="reveal-stage-label">State</span>';
      if (!keys.length) {
        html += '<p>No facts on file for this example yet.</p>';
      } else {
        keys.forEach(function (key) {
          var fact = basedOnFacts[key];
          var valueText = fact.value === null ? 'not yet provided' : fact.value + (fact.unit ? ' ' + fact.unit : '');
          html += '<p><strong>' + escapeHtml(formatFactKey(key)) + ':</strong> ' + escapeHtml(valueText)
            + (fact.met ? ' <span class="is-met">&#10003; meets requirement</span>' : '') + '</p>';
        });
      }
      return html;
    }

    function buildConstraintsStage(constraints) {
      var html = '<span class="reveal-stage-label">Constraints</span>';
      if (!constraints.length) {
        html += '<p>No unresolved constraints on file for this example.</p>';
      } else {
        constraints.forEach(function (c) {
          html += '<p><strong>' + escapeHtml(formatFactKey(c.type)) + ':</strong> ' + escapeHtml(c.description) + '</p>';
        });
      }
      return html;
    }

    function buildOpportunityStage(relatedCapability, missingInformation) {
      var html = '<span class="reveal-stage-label">Opportunities &amp; Unlocks</span>';
      var lines = [];
      if (relatedCapability) {
        lines.push('<strong>' + escapeHtml(relatedCapability.capability.name) + ':</strong> '
          + (relatedCapability.available
            ? relatedCapability.providers.length + ' active provider(s) found.'
            : 'no active provider available yet.'));
      }
      var missingKeys = (missingInformation && missingInformation.missingFactKeys) || [];
      if (missingKeys.length) {
        lines.push('Still unknown: ' + missingKeys.map(formatFactKey).join(', ') + '.');
      }
      if (!lines.length) {
        html += '<p>Nothing further unlocks or blocks this example right now.</p>';
      } else {
        lines.forEach(function (line) { html += '<p>' + line + '</p>'; });
      }
      return html;
    }

    function buildMoveStage(recommendedAction, rationale) {
      var html = '<span class="reveal-stage-label">The CHEW Move</span>';
      if (recommendedAction) {
        html += '<p class="move-action">&ldquo;' + escapeHtml(recommendedAction) + '&rdquo;</p>';
      } else {
        html += '<p class="move-action">Every known requirement is met &mdash; nothing further to recommend for this example.</p>';
      }
      html += '<p style="margin-top:14px;">' + escapeHtml(rationale) + '</p>';
      return html;
    }

    // CHEW Move collapse: renders every real requirement the engine
    // actually evaluated as a chip, then resolves them — met ones dim,
    // the untouched-for-now one(s) recede, and the real chosen
    // requirement (chosenRequirementKey, from the engine, not guessed
    // client-side) expands. Every chip and every classification comes
    // straight from the API response; nothing here is invented content.
    var moveCollapseEl = document.getElementById('move-collapse');
    var moveChipRowEl = document.getElementById('move-chip-row');
    var revealReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pendingTimeouts = [];

    function clearPendingTimeouts() {
      pendingTimeouts.forEach(function (id) { clearTimeout(id); });
      pendingTimeouts = [];
    }

    function buildAndResolveMoveCollapse(basedOnFacts, chosenRequirementKey) {
      var keys = Object.keys(basedOnFacts);
      moveCollapseEl.classList.remove('is-resolved');
      moveChipRowEl.innerHTML = keys.map(function (key) {
        return '<span class="move-chip" data-key="' + escapeHtml(key) + '">' + escapeHtml(formatFactKey(key)) + '</span>';
      }).join('');

      var resolve = function () {
        keys.forEach(function (key) {
          var chip = moveChipRowEl.querySelector('[data-key="' + key.replace(/"/g, '') + '"]');
          if (!chip) return;
          if (key === chosenRequirementKey) {
            chip.classList.add('is-chosen');
          } else if (basedOnFacts[key].met) {
            chip.classList.add('is-met');
          } else {
            chip.classList.add('is-deferred');
          }
        });
        moveCollapseEl.classList.add('is-resolved');
      };

      if (revealReduceMotion) {
        resolve();
      } else {
        pendingTimeouts.push(setTimeout(resolve, 650));
      }
    }

    // CHEW Blind Spot: a deliberate interrupt built from real data only.
    // "Assumed" is any other real unmet requirement besides the one the
    // engine actually chose (chosenRequirementKey) — framed as "a common
    // focus," never as a claim about what this specific visitor thinks,
    // since no personalization exists. If there's no second unmet
    // requirement to contrast against, the panel is skipped entirely
    // rather than forced.
    var blindSpotEl = document.getElementById('blind-spot');
    var blindSpotAssumedLabelEl = document.getElementById('blind-spot-assumed-label');
    var blindSpotActualLabelEl = document.getElementById('blind-spot-actual-label');
    var blindSpotActualNoteEl = document.getElementById('blind-spot-actual-note');

    function findAssumedKey(basedOnFacts, chosenRequirementKey) {
      var keys = Object.keys(basedOnFacts);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key !== chosenRequirementKey && !basedOnFacts[key].met) return key;
      }
      return null;
    }

    function showBlindSpotIfApplicable(basedOnFacts, chosenRequirementKey, recommendedAction) {
      blindSpotEl.classList.remove('is-visible');
      blindSpotEl.hidden = true;
      if (!chosenRequirementKey) return;
      var assumedKey = findAssumedKey(basedOnFacts, chosenRequirementKey);
      if (!assumedKey) return;

      blindSpotAssumedLabelEl.textContent = formatFactKey(assumedKey);
      blindSpotActualLabelEl.textContent = formatFactKey(chosenRequirementKey);
      blindSpotActualNoteEl.textContent = 'This is what CHEW\'s evaluation actually found standing between this example and the goal' + (recommendedAction ? ' — not the thing that usually gets the attention.' : '.');
      blindSpotEl.hidden = false;

      var reveal = function () { blindSpotEl.classList.add('is-visible'); };
      if (revealReduceMotion) {
        reveal();
      } else {
        pendingTimeouts.push(setTimeout(reveal, 1000));
      }
    }

    // CHEW Domino: simulates the real requirement chain cascading from
    // this example's actual current state — NEVER a database write.
    // requirementSequence and the current facts both come straight from
    // the API response already fetched for this goal; the only
    // "hypothetical" step is treating the one currently-chosen
    // requirement as if it were just completed, then showing the real,
    // deterministic consequence of that (which requirement becomes the
    // next real focus, and whether it's tied to a real capability) —
    // exactly one step forward, not a chain of invented completions.
    var dominoSectionEl = document.getElementById('domino-section');
    var dominoTriggerEl = document.getElementById('domino-trigger');
    var dominoRowEl = document.getElementById('domino-row');
    var dominoTimeouts = [];
    var lastRequirementSequence = null;
    var lastBasedOnFacts = null;
    var lastChosenRequirementKey = null;

    function clearDominoTimeouts() {
      dominoTimeouts.forEach(function (id) { clearTimeout(id); });
      dominoTimeouts = [];
    }

    function capabilityStatusLine(tile) {
      if (!tile.capabilitySlug) return '';
      return ' Connected to: ' + escapeHtml(tile.capabilityName) + '.';
    }

    function runDomino() {
      clearDominoTimeouts();
      if (!lastRequirementSequence || !lastRequirementSequence.length) return;

      var chosenIndex = lastRequirementSequence.findIndex(function (t) { return t.key === lastChosenRequirementKey; });
      var tilesHtml = lastRequirementSequence.map(function (tile, i) {
        var met = lastBasedOnFacts[tile.key] && lastBasedOnFacts[tile.key].met;
        var startState = met ? 'is-cleared' : '';
        return '<div class="domino-tile ' + startState + '" data-index="' + i + '">'
          + '<span class="domino-tile-label">' + escapeHtml(tile.label) + '</span>'
          + '<span class="domino-tile-status" data-status></span>'
          + '</div>';
      }).join('<span class="domino-connector" data-connector aria-hidden="true">&rarr;</span>');

      if (chosenIndex !== -1 && chosenIndex === lastRequirementSequence.length - 1) {
        tilesHtml += '<span class="domino-connector" data-connector aria-hidden="true">&rarr;</span>'
          + '<div class="domino-tile is-final" data-final><span class="domino-tile-label">Pathway Clear</span><span class="domino-tile-status" data-status>(simulated)</span></div>';
      }

      dominoRowEl.innerHTML = tilesHtml;
      dominoRowEl.hidden = false;

      var tiles = dominoRowEl.querySelectorAll('.domino-tile');
      var connectors = dominoRowEl.querySelectorAll('.domino-connector');

      // Set the static status text for already-met and locked tiles immediately.
      lastRequirementSequence.forEach(function (tile, i) {
        var statusEl = tiles[i].querySelector('[data-status]');
        var met = lastBasedOnFacts[tile.key] && lastBasedOnFacts[tile.key].met;
        if (met) {
          statusEl.textContent = 'Already met.' + capabilityStatusLine(tile);
        } else if (i === chosenIndex) {
          statusEl.textContent = 'CHEW\'s current real focus.' + capabilityStatusLine(tile);
        } else {
          statusEl.textContent = 'Comes after.' + capabilityStatusLine(tile);
        }
      });

      var runStep = function (delay, fn) {
        if (revealReduceMotion) { fn(); } else { dominoTimeouts.push(setTimeout(fn, delay)); }
      };

      if (chosenIndex === -1) return; // everything already met — nothing to simulate falling

      runStep(400, function () {
        tiles[chosenIndex].classList.add('is-falling');
        if (connectors[chosenIndex]) connectors[chosenIndex].classList.add('is-lit');
      });
      runStep(revealReduceMotion ? 0 : 950, function () {
        tiles[chosenIndex].classList.remove('is-falling');
        tiles[chosenIndex].classList.add('is-cleared');
        tiles[chosenIndex].querySelector('[data-status]').textContent = 'Simulated: clears now.' + capabilityStatusLine(lastRequirementSequence[chosenIndex]);

        // tiles[] includes the synthetic "Pathway Clear" tile when
        // present, so checking lastRequirementSequence.length (not just
        // whether tiles[chosenIndex + 1] exists) is what correctly tells
        // a real next requirement apart from that synthetic tile.
        var hasRealNextRequirement = chosenIndex + 1 < lastRequirementSequence.length;
        if (hasRealNextRequirement) {
          var nextTile = tiles[chosenIndex + 1];
          nextTile.classList.add('is-active');
          nextTile.querySelector('[data-status]').textContent = 'Becomes CHEW\'s next real focus.' + capabilityStatusLine(lastRequirementSequence[chosenIndex + 1]);
        } else {
          var finalTile = dominoRowEl.querySelector('[data-final]');
          if (finalTile) finalTile.classList.add('is-active');
        }
      });
    }

    if (dominoTriggerEl) {
      dominoTriggerEl.addEventListener('click', runDomino);
    }

    // CHEW Opportunity Radar: every real capability in the registry
    // (api/intelligence-demo.js -> lib/capabilityGraph.js
    // getCapabilityOverview), positioned radially. "Connected" means this
    // capability is actually linked (capability_id) to a requirement in
    // this example's real sequence, not a guess. "Available" means a live
    // COUNT of active, ready providers is greater than zero. There is no
    // fabricated freshness/urgency state anywhere in this feature.
    var radarSectionEl = document.getElementById('radar-section');
    var radarTriggerEl = document.getElementById('radar-trigger');
    var radarWrapEl = document.getElementById('radar-wrap');
    var radarNodesEl = document.getElementById('radar-nodes');
    var radarDetailEl = document.getElementById('radar-detail');
    var lastCapabilityOverview = null;

    function radarConnectedSlugs() {
      if (!lastRequirementSequence) return [];
      return lastRequirementSequence
        .filter(function (t) { return t.capabilitySlug; })
        .map(function (t) { return t.capabilitySlug; });
    }

    function showRadarDetail(cap, connectedSlugs) {
      var isConnected = connectedSlugs.indexOf(cap.slug) !== -1;
      var matchedTile = isConnected && lastRequirementSequence
        ? lastRequirementSequence.filter(function (t) { return t.capabilitySlug === cap.slug; })[0]
        : null;
      var html = '<span class="radar-detail-name">' + escapeHtml(cap.name) + '</span>';
      html += '<p>' + (cap.available
        ? cap.activeProviderCount + ' active provider' + (cap.activeProviderCount === 1 ? '' : 's') + ' in the network right now.'
        : 'No active provider in the network yet.') + '</p>';
      if (matchedTile) {
        html += '<p>Connected to this example\'s real requirement: <strong>' + escapeHtml(matchedTile.label) + '</strong>.</p>';
      } else {
        html += '<p>Not tied to any requirement in this example\'s sequence.</p>';
      }
      radarDetailEl.innerHTML = html;
      radarDetailEl.hidden = false;
    }

    function layoutRadarNode(el, index, total, radius) {
      var angle = (360 / total) * index - 90;
      var rad = angle * Math.PI / 180;
      el.style.left = (210 + radius * Math.cos(rad)) + 'px';
      el.style.top = (210 + radius * Math.sin(rad)) + 'px';
    }

    function runRadar() {
      if (!lastCapabilityOverview || !lastCapabilityOverview.length) return;
      var connectedSlugs = radarConnectedSlugs();
      radarDetailEl.hidden = true;
      radarDetailEl.innerHTML = '';

      radarNodesEl.innerHTML = lastCapabilityOverview.map(function (cap, i) {
        var isConnected = connectedSlugs.indexOf(cap.slug) !== -1;
        var cls = 'radar-node' + (isConnected ? ' is-connected' : '') + (isConnected && cap.available ? ' is-available' : '');
        return '<button type="button" class="' + cls + '" data-index="' + i + '">' + escapeHtml(cap.name) + '</button>';
      }).join('');
      radarWrapEl.hidden = false;

      var nodeEls = radarNodesEl.querySelectorAll('.radar-node');
      nodeEls.forEach(function (el, i) {
        layoutRadarNode(el, i, lastCapabilityOverview.length, 165);
        el.addEventListener('click', function () {
          nodeEls.forEach(function (n) { n.classList.remove('is-selected'); });
          el.classList.add('is-selected');
          showRadarDetail(lastCapabilityOverview[i], connectedSlugs);
        });
      });

      if (connectedSlugs.length === 0) {
        radarDetailEl.innerHTML = '<p>None of these real capabilities are connected to this particular example\'s requirement sequence &mdash; honestly, because this scenario doesn\'t currently route through the network. Tap any node to see its own live status.</p>';
        radarDetailEl.hidden = false;
      }
    }

    if (radarTriggerEl) {
      radarTriggerEl.addEventListener('click', runRadar);
    }

    // CHEW Future-Back: walks the real requirement chain backward from the
    // real goal to "today" — the same requirementSequence + basedOnFacts +
    // chosenRequirementKey already fetched for Move/Domino, just walked in
    // reverse order. Nothing here is invented: the destination is the real
    // goals.title row (goalTitle), each stage is a real transition_requirement,
    // and "TODAY — START HERE" lands on the real chosenRequirementKey — the
    // same one CHEW Move and CHEW Blind Spot already treat as the current
    // real focus. No database write, same hard rule as Domino and Radar.
    var futurebackSectionEl = document.getElementById('futureback-section');
    var futurebackTriggerEl = document.getElementById('futureback-trigger');
    var futurebackChainEl = document.getElementById('futureback-chain');
    var futurebackTimeouts = [];
    var lastGoalTitle = null;

    function clearFuturebackTimeouts() {
      futurebackTimeouts.forEach(function (id) { clearTimeout(id); });
      futurebackTimeouts = [];
    }

    function runFutureBack() {
      clearFuturebackTimeouts();
      if (!lastRequirementSequence || !lastRequirementSequence.length) return;

      var chosenIndex = lastRequirementSequence.findIndex(function (t) { return t.key === lastChosenRequirementKey; });
      var goalLabel = lastGoalTitle || 'This example\'s goal';
      var stagesHtml = '<div class="futureback-stage futureback-stage--goal" data-index="0">'
        + '<span class="futureback-stage-eyebrow">The Real Goal</span>'
        + '<span class="futureback-stage-label">' + escapeHtml(goalLabel) + '</span>'
        + '</div>';

      if (chosenIndex === -1) {
        stagesHtml += '<div class="futureback-arrow" aria-hidden="true">&darr;</div>'
          + '<div class="futureback-stage futureback-stage--today" data-index="1">'
          + '<span class="futureback-stage-eyebrow">Today</span>'
          + '<span class="futureback-stage-label">Every real requirement for this goal is already met in this example.</span>'
          + '</div>';
        futurebackChainEl.innerHTML = stagesHtml;
        futurebackChainEl.hidden = false;
        var onlyStage = futurebackChainEl.querySelectorAll('.futureback-stage');
        onlyStage.forEach(function (el) { el.classList.add('is-visible'); });
        return;
      }

      var forward = lastRequirementSequence.slice(chosenIndex).slice().reverse();
      var resolved = lastRequirementSequence.slice(0, chosenIndex);

      forward.forEach(function (tile, i) {
        var isToday = i === forward.length - 1;
        stagesHtml += '<div class="futureback-arrow" aria-hidden="true">&darr;</div>';
        stagesHtml += '<div class="futureback-stage' + (isToday ? ' futureback-stage--today' : '') + '" data-index="' + (i + 1) + '">'
          + '<span class="futureback-stage-eyebrow">' + (isToday ? 'Today &mdash; Start Here' : 'For that to be true, first') + '</span>'
          + '<span class="futureback-stage-label">' + escapeHtml(tile.label) + '</span>'
          + '<span class="futureback-stage-note">' + escapeHtml(tile.actionIfUnmet || '') + '</span>'
          + '</div>';
      });

      if (resolved.length) {
        stagesHtml += '<p class="futureback-resolved">Already true, before this point in the chain: '
          + resolved.map(function (t) { return escapeHtml(t.label); }).join(', ') + '.</p>';
      }

      futurebackChainEl.innerHTML = stagesHtml;
      futurebackChainEl.hidden = false;

      var stageEls = futurebackChainEl.querySelectorAll('.futureback-stage');
      stageEls.forEach(function (el, i) {
        var reveal = function () { el.classList.add('is-visible'); };
        if (revealReduceMotion) { reveal(); } else { futurebackTimeouts.push(setTimeout(reveal, 300 + i * 260)); }
      });
    }

    if (futurebackTriggerEl) {
      futurebackTriggerEl.addEventListener('click', runFutureBack);
    }

    goalButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        clearPendingTimeouts();
        clearDominoTimeouts();
        dominoSectionEl.hidden = true;
        dominoRowEl.hidden = true;
        dominoRowEl.innerHTML = '';
        radarSectionEl.hidden = true;
        radarWrapEl.hidden = true;
        radarNodesEl.innerHTML = '';
        radarDetailEl.hidden = true;
        radarDetailEl.innerHTML = '';
        clearFuturebackTimeouts();
        futurebackSectionEl.hidden = true;
        futurebackChainEl.hidden = true;
        futurebackChainEl.innerHTML = '';
        goalButtons.forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        statusEl.textContent = 'CHEW is thinking...';
        statusEl.classList.remove('is-error');
        resultEl.hidden = true;
        chainEl.classList.remove('is-visible');

        fetch('/api/intelligence-demo?goal=' + encodeURIComponent(btn.getAttribute('data-goal')))
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Lookup failed'); });
            return res.json();
          })
          .then(function (data) {
            statusEl.textContent = '';
            disclaimerEl.textContent = data.disclaimer;
            var rec = data.recommendation;
            chainEl.innerHTML =
              '<div class="reveal-stage">' + buildStateStage(rec.basedOnFacts) + '</div>'
              + '<div class="reveal-arrow-row" aria-hidden="true">&darr;</div>'
              + '<div class="reveal-stage">' + buildConstraintsStage(rec.basedOnConstraints) + '</div>'
              + '<div class="reveal-arrow-row" aria-hidden="true">&darr;</div>'
              + '<div class="reveal-stage">' + buildOpportunityStage(rec.relatedCapability, rec.missingInformation) + '</div>'
              + '<div class="reveal-arrow-row" aria-hidden="true">&darr;</div>'
              + '<div class="reveal-stage chew-move intelligence-pulse">' + buildMoveStage(rec.recommendedAction, rec.rationale) + '</div>';
            resultEl.hidden = false;
            buildAndResolveMoveCollapse(rec.basedOnFacts, rec.chosenRequirementKey);
            showBlindSpotIfApplicable(rec.basedOnFacts, rec.chosenRequirementKey, rec.recommendedAction);
            lastRequirementSequence = data.requirementSequence || null;
            lastBasedOnFacts = rec.basedOnFacts;
            lastChosenRequirementKey = rec.chosenRequirementKey;
            lastCapabilityOverview = data.capabilityOverview || null;
            lastGoalTitle = data.goalTitle || null;
            if (revealReduceMotion) {
              chainEl.classList.add('is-visible');
              dominoSectionEl.hidden = false;
              radarSectionEl.hidden = false;
              futurebackSectionEl.hidden = false;
            } else {
              pendingTimeouts.push(setTimeout(function () { chainEl.classList.add('is-visible'); }, 1700));
              pendingTimeouts.push(setTimeout(function () { dominoSectionEl.hidden = false; }, 2000));
              pendingTimeouts.push(setTimeout(function () { radarSectionEl.hidden = false; }, 2300));
              pendingTimeouts.push(setTimeout(function () { futurebackSectionEl.hidden = false; }, 2600));
            }
            resultEl.scrollIntoView({ behavior: revealReduceMotion ? 'auto' : 'smooth', block: 'nearest' });
          })
          .catch(function (err) {
            statusEl.textContent = err.message || 'CHEW couldn\'t load this example right now.';
            statusEl.classList.add('is-error');
          });
      });
    });
  }
});
