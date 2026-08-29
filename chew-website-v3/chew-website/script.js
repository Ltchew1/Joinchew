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
      var skipBtn = document.getElementById('activation-skip');
      if (skipBtn) {
        skipBtn.addEventListener('click', function (e) { e.stopPropagation(); finishActivation(); });
      }
      var activationTimeoutMs = window.matchMedia && window.matchMedia('(max-width: 640px)').matches ? 1900 : 2300;
      setTimeout(finishActivation, activationTimeoutMs);
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

  // Shared across the hero goal picker and the Life Map below it: which
  // real demo goal (if any) the visitor has already picked in the hero,
  // so Life Map can carry that choice forward (goal continuity) instead
  // of resetting to a neutral state every section.
  var chewLastSelectedGoal = null;

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
    // One short, concise story per territory — why CHEW treats its
    // connections as worth tracking together, not a textbook entry.
    // Same editorial status as LIFEMAP_EDGES above, not a separate claim.
    var LIFEMAP_WHY = {
      credit: 'Credit changes can quietly reopen or close off financing across several other areas at once.',
      capital: 'Capital is the fuel other moves run on — how much exists changes what becomes possible elsewhere.',
      business: 'A business rarely stays contained to itself — it pulls on personal credit, capital, and coverage as it grows.',
      property: 'Property ties up credit, capital, and protection all at once — one of the most connected moves CHEW tracks.',
      insurance: 'What you build is only as secure as what protects it — insurance is the quiet dependency behind the rest.',
      assets: 'Assets are where other moves eventually land — capital, business, and property all tend to become one.',
      liquidity: 'What you can use right now shapes which other moves are even on the table today.',
      ownership: 'Ownership compounds — it both results from other moves and becomes leverage for the next one.',
    };

    var lifemapHint = document.getElementById('lifemap-hint');
    var lifemapDetail = document.getElementById('lifemap-detail');
    var lifemapMobileEl = document.getElementById('lifemap-mobile');
    var lifemapSignatureEl = document.getElementById('lifemap-signature');
    var lifemapSectionEl = document.getElementById('hx-lifemap-section');
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

    // Real vertical mobile composition — built once from the exact same
    // LIFEMAP_LABELS data above, not a second map model. Wired into the
    // same lifemapSelect()/lifemapClearState() functions as the desktop
    // SVG hit targets below, via the shared [data-territory] contract.
    if (lifemapMobileEl) {
      lifemapMobileEl.innerHTML = Object.keys(LIFEMAP_LABELS).map(function (t) {
        return '<button type="button" class="lifemap-mobile-item" data-territory="' + t + '" aria-pressed="false">'
          + '<span class="lifemap-mobile-dot" aria-hidden="true"></span>'
          + '<span class="lifemap-mobile-name">' + lifemapEscapeHtml(LIFEMAP_LABELS[t]) + '</span>'
          + '</button>';
      }).join('');
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
      if (lifemapMobileEl) {
        lifemapMobileEl.classList.remove('has-selection');
        lifemapMobileEl.querySelectorAll('.lifemap-mobile-item').forEach(function (el) {
          el.classList.remove('is-selected', 'is-connected');
          el.setAttribute('aria-pressed', 'false');
        });
      }
    }

    function lifemapDeselect() {
      lifemapSelected = null;
      lifemapWrap.classList.remove('has-selection');
      lifemapClearState();
      lifemapDetail.hidden = true;
      lifemapDetail.innerHTML = '';
      if (lifemapHint) lifemapHint.style.opacity = '1';
    }

    // auto: true only for the goal-continuity reveal below — suppresses
    // the scroll-into-view a real user click should still get, since an
    // auto-selection fires while the visitor is already mid-scroll into
    // this exact section.
    function lifemapSelect(territory, auto) {
      if (lifemapSelected === territory) { if (!auto) lifemapDeselect(); return; }
      lifemapSelected = territory;
      lifemapWrap.classList.add('has-selection');
      if (lifemapMobileEl) lifemapMobileEl.classList.add('has-selection');
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

      if (lifemapMobileEl) {
        var mobileSelected = lifemapMobileEl.querySelector('.lifemap-mobile-item[data-territory="' + territory + '"]');
        if (mobileSelected) { mobileSelected.classList.add('is-selected'); mobileSelected.setAttribute('aria-pressed', 'true'); }
        Object.keys(connectedSet).forEach(function (t) {
          var el = lifemapMobileEl.querySelector('.lifemap-mobile-item[data-territory="' + t + '"]');
          if (el) el.classList.add('is-connected');
        });
      }

      var html = '<span class="lifemap-detail-eyebrow">' + lifemapEscapeHtml(LIFEMAP_LABELS[territory]) + ' connects to</span>'
        + '<ul class="lifemap-detail-list">'
        + connections.map(function (c) {
          return '<li><strong>' + lifemapEscapeHtml(LIFEMAP_LABELS[c.other]) + '</strong> — ' + lifemapEscapeHtml(c.reason) + '</li>';
        }).join('')
        + '</ul>'
        + '<p class="lifemap-detail-why"><span class="lifemap-detail-why-label">Why CHEW connects these</span>'
        + lifemapEscapeHtml(LIFEMAP_WHY[territory] || '') + '</p>'
        + '<button type="button" class="lifemap-detail-close" id="lifemap-detail-close">Clear selection</button>';
      lifemapDetail.innerHTML = html;
      lifemapDetail.hidden = false;
      if (lifemapHint) lifemapHint.style.opacity = '0';

      var closeBtn = document.getElementById('lifemap-detail-close');
      if (closeBtn) closeBtn.addEventListener('click', lifemapDeselect);

      if (!auto && !lifemapReduceMotion) {
        lifemapDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    lifemapWrap.querySelectorAll('.lifemap-hit').forEach(function (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        lifemapSelect(btn.getAttribute('data-territory'));
      });
    });
    if (lifemapMobileEl) {
      lifemapMobileEl.querySelectorAll('.lifemap-mobile-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
          lifemapSelect(btn.getAttribute('data-territory'));
        });
      });
    }

    // Signature reveal: fires once, the first time the Life Map scrolls
    // into view. Nodes/edges stagger-draw (CSS, via the real --node-
    // delay/--edge-delay custom properties already on each element),
    // then — only if the visitor already picked a real goal in the hero
    // above — CHEW carries that choice forward by auto-selecting the
    // one territory this goal is editorially mapped to (goal continuity).
    // With no prior goal selection, the map simply settles into its
    // neutral, fully-visible state and invites exploration instead.
    var LIFEMAP_GOAL_FOCUS = { home: 'property', funding: 'business' };
    var lifemapRevealed = false;

    function runLifemapReveal() {
      if (lifemapRevealed) return;
      lifemapRevealed = true;
      if (lifemapSectionEl) lifemapSectionEl.classList.add('is-revealed');
      lifemapWrap.classList.add('is-revealed');

      var settle = function () {
        var focusTerritory = chewLastSelectedGoal ? LIFEMAP_GOAL_FOCUS[chewLastSelectedGoal] : null;
        if (focusTerritory) lifemapSelect(focusTerritory, true);
        if (lifemapSignatureEl) lifemapSignatureEl.classList.add('is-visible');
      };
      if (lifemapReduceMotion) settle();
      else setTimeout(settle, 950);
    }

    if (lifemapSectionEl && 'IntersectionObserver' in window) {
      var lifemapObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            runLifemapReveal();
            lifemapObserver.disconnect();
          }
        });
      }, { threshold: 0.3 });
      lifemapObserver.observe(lifemapSectionEl);
    } else {
      runLifemapReveal();
    }
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

    // THE CHEW MOVE REVEAL — the hero's live node field. Every real
    // requirement in the engine's actual sequence (requirementSequence,
    // real sequence_order from transition_requirements) appears as a
    // node around the hub. Five real, staged states — never a fabricated
    // "blocked" state, since nothing in this schema records a
    // requirement literally blocking another:
    //   1. all nodes appear together, considering (pulsing, neutral)
    //   2. real met:true requirements settle — "Resolved"
    //   3. requirements sharing a real capability_slug get a connecting
    //      arc — "Connected" (only renders when 2+ genuinely share one;
    //      with today's seed data this is real but usually dormant,
    //      same honest gap the rest of this build already discloses)
    //   4. remaining real unmet, non-chosen requirements recede —
    //      "Next in sequence" (real sequenceOrder, not invented causality)
    //   5. the real chosenRequirementKey scales up — THE CHEW MOVE, with
    //      the engine's own real recommendedAction/rationale text
    var revealReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pendingTimeouts = [];

    function clearPendingTimeouts() {
      pendingTimeouts.forEach(function (id) { clearTimeout(id); });
      pendingTimeouts = [];
    }

    var hxFieldWrapEl = document.getElementById('hx-field-wrap');
    var hxFieldEl = document.getElementById('hx-field');
    var hxFieldSvgEl = document.getElementById('hx-field-svg');
    var hxMoveBannerEl = document.getElementById('hx-move-banner');
    var hxMoveActionEl = document.getElementById('hx-move-action');
    var hxMoveRationaleEl = document.getElementById('hx-move-rationale');
    var HX_VB_W = 400, HX_VB_H = 370, HX_HUB_X = 200, HX_HUB_Y = 178, HX_RADIUS = 132;

    // Persistent "Current Move" recall — keeps the real chosen move
    // visible as the visitor explores deeper (Life Map, the below-field
    // breakdown), instead of the hero's own banner being a one-shot
    // reveal that vanishes the moment it scrolls out of view. Shows only
    // when BOTH are true: a real move exists (recall text set) AND the
    // hero's own banner is actually out of view — never a fabricated
    // "reminder" for a move that hasn't been computed yet.
    var hxMoveRecallEl = document.getElementById('hx-move-recall');
    var hxMoveRecallTextEl = document.getElementById('hx-move-recall-text');
    var hxMoveRecallLinkEl = document.getElementById('hx-move-recall-link');
    var hxMoveBannerInView = true;
    var hxHasRealMove = false;

    function syncMoveRecallVisibility() {
      if (hxHasRealMove && !hxMoveBannerInView) hxMoveRecallEl.classList.add('is-visible');
      else hxMoveRecallEl.classList.remove('is-visible');
    }
    if ('IntersectionObserver' in window) {
      var moveRecallObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { hxMoveBannerInView = entry.isIntersecting; });
        syncMoveRecallVisibility();
      }, { threshold: 0 });
      moveRecallObserver.observe(hxMoveBannerEl);
    }
    if (hxMoveRecallLinkEl) {
      hxMoveRecallLinkEl.addEventListener('click', function () {
        hxMoveBannerEl.scrollIntoView({ behavior: revealReduceMotion ? 'auto' : 'smooth', block: 'center' });
      });
    }

    function resetHeroField() {
      hxFieldEl.classList.remove('is-ready', 'is-drawn');
      hxFieldSvgEl.innerHTML = '';
      hxFieldEl.querySelectorAll('.hx-node').forEach(function (n) { n.remove(); });
      hxMoveBannerEl.classList.remove('is-visible');
      hxMoveActionEl.textContent = '';
      hxMoveRationaleEl.textContent = '';
      hxHasRealMove = false;
      syncMoveRecallVisibility();
    }

    function nodePosition(index, total) {
      // Exactly 2 nodes at the default -90deg start would sit in a plain
      // vertical line through the hub; offset the start angle so a
      // 2-requirement real sequence (e.g. the funding-ready example)
      // still reads as a spatial field, not a straight stick.
      var startAngle = total === 2 ? -55 : -90;
      var angle = (360 / total) * index + startAngle;
      var rad = angle * Math.PI / 180;
      return { x: HX_HUB_X + HX_RADIUS * Math.cos(rad), y: HX_HUB_Y + HX_RADIUS * Math.sin(rad) };
    }

    // requirementSequence: real, ordered transition_requirements (each
    // with key/label/sequenceOrder/capabilitySlug). basedOnFacts: real
    // met/value per key, from the same engine call. chosenRequirementKey
    // and recommendedAction/rationale: the engine's own real output —
    // never recomputed or guessed client-side.
    function renderHeroField(requirementSequence, basedOnFacts, chosenRequirementKey, recommendedAction, rationale) {
      resetHeroField();
      hxFieldWrapEl.classList.add('has-selection');
      var tiles = (requirementSequence || []).filter(function (t) { return basedOnFacts[t.key]; });
      if (!tiles.length) {
        hxFieldEl.classList.add('is-ready');
        return;
      }
      var total = tiles.length;

      // Real capability-sharing groups: 2+ requirements with the same
      // non-null capabilitySlug. Empty today for both real demo goals —
      // the mechanism is real, current seed data just doesn't exercise it.
      var slugGroups = {};
      tiles.forEach(function (t, i) {
        if (!t.capabilitySlug) return;
        (slugGroups[t.capabilitySlug] = slugGroups[t.capabilitySlug] || []).push(i);
      });

      var svgParts = [];
      svgParts.push('<circle class="hx-node-hub-dot" cx="' + HX_HUB_X + '" cy="' + HX_HUB_Y + '" r="0" fill="none"/>');
      tiles.forEach(function (t, i) {
        var pos = nodePosition(i, total);
        svgParts.push('<path class="hx-edge" data-index="' + i + '" d="M' + HX_HUB_X + ',' + HX_HUB_Y + ' L' + pos.x.toFixed(1) + ',' + pos.y.toFixed(1) + '"/>');
      });
      Object.keys(slugGroups).forEach(function (slug) {
        var idxs = slugGroups[slug];
        if (idxs.length < 2) return;
        for (var g = 0; g < idxs.length - 1; g++) {
          var a = nodePosition(idxs[g], total), b = nodePosition(idxs[g + 1], total);
          var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 18;
          svgParts.push('<path class="hx-group-arc" data-slug="' + escapeHtml(slug) + '" d="M' + a.x.toFixed(1) + ',' + a.y.toFixed(1) + ' Q' + mx.toFixed(1) + ',' + my.toFixed(1) + ' ' + b.x.toFixed(1) + ',' + b.y.toFixed(1) + '"/>');
        }
      });
      hxFieldSvgEl.innerHTML = svgParts.join('');

      var hub = document.createElement('div');
      hub.className = 'hx-node hx-node--hub';
      hub.style.left = (HX_HUB_X / HX_VB_W * 100) + '%';
      hub.style.top = (HX_HUB_Y / HX_VB_H * 100) + '%';
      hub.innerHTML = '<span class="hx-node-dot"></span><span class="hx-node-label">CHEW</span>';
      hxFieldEl.appendChild(hub);

      var nodeEls = tiles.map(function (t, i) {
        var pos = nodePosition(i, total);
        var el = document.createElement('div');
        el.className = 'hx-node is-considering';
        el.style.left = (pos.x / HX_VB_W * 100) + '%';
        el.style.top = (pos.y / HX_VB_H * 100) + '%';
        el.innerHTML = '<span class="hx-node-dot"></span><span class="hx-node-label">' + escapeHtml(t.label) + '</span><span class="hx-node-status"></span>';
        hxFieldEl.appendChild(el);
        return el;
      });

      var edgeEls = function () { return hxFieldSvgEl.querySelectorAll('.hx-edge'); };

      var runStage = function (delay, fn) {
        if (revealReduceMotion) { fn(); } else { pendingTimeouts.push(setTimeout(fn, delay)); }
      };

      runStage(0, function () {
        hxFieldEl.classList.add('is-ready');
        requestAnimationFrame(function () { hxFieldEl.classList.add('is-drawn'); });
      });

      runStage(650, function () {
        tiles.forEach(function (t, i) {
          if (basedOnFacts[t.key].met) {
            nodeEls[i].classList.remove('is-considering');
            nodeEls[i].classList.add('is-resolved');
            nodeEls[i].querySelector('.hx-node-status').textContent = 'Resolved';
            var edge = edgeEls()[i];
            if (edge) edge.classList.add('is-resolved-edge');
          }
        });
      });

      runStage(1150, function () {
        hxFieldSvgEl.querySelectorAll('.hx-group-arc').forEach(function (arc) { arc.classList.add('is-visible'); });
      });

      runStage(1650, function () {
        tiles.forEach(function (t, i) {
          if (!basedOnFacts[t.key].met && t.key !== chosenRequirementKey) {
            nodeEls[i].classList.remove('is-considering');
            nodeEls[i].classList.add('is-deferred');
            nodeEls[i].querySelector('.hx-node-status').textContent = 'Next in sequence';
            var edge = edgeEls()[i];
            if (edge) edge.classList.add('is-deferred-edge');
          }
        });
      });

      runStage(2150, function () {
        if (chosenRequirementKey) {
          var chosenIndex = tiles.findIndex(function (t) { return t.key === chosenRequirementKey; });
          if (chosenIndex !== -1) {
            nodeEls[chosenIndex].classList.remove('is-considering');
            nodeEls[chosenIndex].classList.add('is-chosen');
            nodeEls[chosenIndex].querySelector('.hx-node-status').textContent = 'The Move';
            var edge = edgeEls()[chosenIndex];
            if (edge) edge.classList.add('is-chosen-edge');
          }
        }
        var moveText = recommendedAction || 'Every known requirement is met — nothing further to recommend for this example.';
        hxMoveActionEl.textContent = moveText;
        hxMoveRationaleEl.textContent = rationale || '';
        hxMoveBannerEl.classList.add('is-visible');
        hxMoveRecallTextEl.textContent = moveText;
        hxHasRealMove = true;
        syncMoveRecallVisibility();
      });
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
    var dominoExplainEl = document.getElementById('domino-explain');
    var dominoCtaEl = document.getElementById('domino-cta');
    var dominoUnlockLinkEl = document.getElementById('domino-unlock-link');
    var dominoTimeouts = [];
    var lastRequirementSequence = null;
    var lastBasedOnFacts = null;
    var lastChosenRequirementKey = null;

    function clearDominoTimeouts() {
      dominoTimeouts.forEach(function (id) { clearTimeout(id); });
      dominoTimeouts = [];
    }

    var GATE_GLYPH =
      '<svg class="domino-node-gate" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + '<path class="shackle" d="M8 10V7a4 4 0 0 1 8 0v3" stroke-linecap="round"/>'
      + '<rect class="body" x="5" y="10" width="14" height="10" rx="2"/>'
      + '</svg>';

    function capabilityOpportunityLine(tile) {
      if (!tile.capabilitySlug) return null;
      var cap = lastCapabilityOverview ? lastCapabilityOverview.filter(function (c) { return c.slug === tile.capabilitySlug; })[0] : null;
      if (!cap) return 'Real capability connected: ' + escapeHtml(tile.capabilityName);
      return 'Real capability connected: ' + escapeHtml(tile.capabilityName) + ' — '
        + (cap.available ? cap.activeProviderCount + ' active provider' + (cap.activeProviderCount === 1 ? '' : 's') : 'no active provider yet');
    }

    // THE MOVE, echoed at the top of the chain — the same real chosen
    // tile and action text the hero already revealed, never re-derived,
    // so this reads as "what the Move above causes," not a fresh guess.
    function dominoMoveHeaderHtml(chosenTile) {
      if (!chosenTile) return '';
      return '<div class="domino-node domino-node--move is-active" role="listitem" style="border-color:var(--gold-light);">'
        + GATE_GLYPH
        + '<div class="domino-node-body">'
        + '<span class="domino-node-status" style="color:var(--gold-light); text-transform:uppercase; letter-spacing:0.08em; font-size:0.68rem; font-weight:700;">The Move</span>'
        + '<span class="domino-node-label">' + escapeHtml(chosenTile.label) + '</span>'
        + '</div></div>'
        + '<span class="domino-trace-seg domino-trace-seg--move is-lit" aria-hidden="true"></span>';
    }

    function runDomino() {
      clearDominoTimeouts();
      if (!lastRequirementSequence || !lastRequirementSequence.length) return;

      var chosenIndex = lastRequirementSequence.findIndex(function (t) { return t.key === lastChosenRequirementKey; });
      dominoExplainEl.hidden = false;
      dominoExplainEl.classList.remove('is-visible');
      dominoCtaEl.hidden = false;
      dominoCtaEl.classList.remove('is-visible');
      dominoExplainEl.innerHTML = '';

      var nodesHtml = lastRequirementSequence.map(function (tile, i) {
        var met = lastBasedOnFacts[tile.key] && lastBasedOnFacts[tile.key].met;
        var startState = met ? 'is-cleared' : '';
        return '<div class="domino-node ' + startState + '" role="listitem" data-index="' + i + '">'
          + GATE_GLYPH
          + '<div class="domino-node-body">'
          + '<span class="domino-node-label">' + escapeHtml(tile.label) + '</span>'
          + '<span class="domino-node-status" data-status></span>'
          + '<span class="domino-node-opportunity" data-opportunity hidden></span>'
          + '</div></div>';
      }).join('<span class="domino-trace-seg" data-connector></span>');

      if (chosenIndex !== -1 && chosenIndex === lastRequirementSequence.length - 1) {
        nodesHtml += '<span class="domino-trace-seg" data-connector></span>'
          + '<div class="domino-node is-final" role="listitem" data-final><div class="domino-node-body">'
          + '<span class="domino-node-label">Pathway Clear</span>'
          + '<span class="domino-node-status" data-status>(sample)</span>'
          + '</div></div>';
      }

      var chosenTile = chosenIndex !== -1 ? lastRequirementSequence[chosenIndex] : null;
      dominoRowEl.innerHTML = dominoMoveHeaderHtml(chosenTile) + nodesHtml;
      dominoRowEl.hidden = false;

      var tiles = dominoRowEl.querySelectorAll('.domino-node:not(.domino-node--move)');
      var connectors = dominoRowEl.querySelectorAll('.domino-trace-seg:not(.domino-trace-seg--move)');

      // Set the static status text for already-met and locked tiles immediately.
      lastRequirementSequence.forEach(function (tile, i) {
        var statusEl = tiles[i].querySelector('[data-status]');
        var met = lastBasedOnFacts[tile.key] && lastBasedOnFacts[tile.key].met;
        if (met) {
          statusEl.textContent = 'Already met.';
        } else if (i === chosenIndex) {
          statusEl.textContent = 'CHEW\'s current real focus.';
        } else {
          statusEl.textContent = 'Comes after in sequence.';
        }
      });

      var runStep = function (delay, fn) {
        if (revealReduceMotion) { fn(); } else { dominoTimeouts.push(setTimeout(fn, delay)); }
      };

      if (chosenIndex === -1) return; // everything already met — nothing to simulate falling

      // Step: the chosen requirement locks into focus and resolves.
      tiles[chosenIndex].setAttribute('aria-current', 'step');
      runStep(400, function () {
        tiles[chosenIndex].classList.add('is-falling');
        if (connectors[chosenIndex]) connectors[chosenIndex].classList.add('is-lit');
      });
      runStep(revealReduceMotion ? 0 : 950, function () {
        tiles[chosenIndex].classList.remove('is-falling');
        tiles[chosenIndex].classList.add('is-cleared');
        tiles[chosenIndex].removeAttribute('aria-current');
        tiles[chosenIndex].querySelector('[data-status]').textContent = 'Sample: clears now.';

        // tiles[] includes the synthetic "Pathway Clear" tile when
        // present, so checking lastRequirementSequence.length (not just
        // whether tiles[chosenIndex + 1] exists) is what correctly tells
        // a real next requirement apart from that synthetic tile.
        var hasRealNextRequirement = chosenIndex + 1 < lastRequirementSequence.length;
        var explainHtml;
        if (hasRealNextRequirement) {
          var nextTile = lastRequirementSequence[chosenIndex + 1];
          var nextEl = tiles[chosenIndex + 1];
          nextEl.classList.add('is-active');
          nextEl.setAttribute('aria-current', 'step');
          nextEl.querySelector('[data-status]').textContent = 'Becomes CHEW\'s next real focus.';
          var oppLine = capabilityOpportunityLine(nextTile);
          if (oppLine) {
            runStep(revealReduceMotion ? 0 : 500, function () {
              var oppEl = nextEl.querySelector('[data-opportunity]');
              oppEl.textContent = oppLine;
              oppEl.hidden = false;
              requestAnimationFrame(function () { oppEl.classList.add('is-visible'); });
            });
          }
          explainHtml = '<span class="domino-explain-label">Why This Changed</span><p>"' + escapeHtml(chosenTile.label) + '" was next in CHEW\'s real sequence'
            + (lastGoalTitle ? ' for "' + escapeHtml(lastGoalTitle) + '"' : '') + '. Once resolved, "' + escapeHtml(nextTile.label)
            + '" becomes the real next focus' + (oppLine ? ', with a real capability already connected to it.' : '.') + '</p>';
        } else {
          var finalEl = dominoRowEl.querySelector('[data-final]');
          if (finalEl) finalEl.classList.add('is-active');
          explainHtml = '<span class="domino-explain-label">Why This Changed</span><p>"' + escapeHtml(chosenTile.label) + '" was the last real unmet requirement in this sequence'
            + (lastGoalTitle ? ' for "' + escapeHtml(lastGoalTitle) + '"' : '') + '. Once resolved, every known requirement is honestly met for this example.</p>';
        }
        runStep(revealReduceMotion ? 0 : 500, function () {
          dominoExplainEl.innerHTML = explainHtml;
          dominoExplainEl.classList.add('is-visible');
        });
        runStep(revealReduceMotion ? 0 : 850, function () {
          if (dominoUnlockLinkEl && chewLastSelectedGoal) {
            dominoUnlockLinkEl.setAttribute('href', 'unlock-room.html?goal=' + encodeURIComponent(chewLastSelectedGoal));
          }
          dominoCtaEl.classList.add('is-visible');
        });
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
        chewLastSelectedGoal = btn.getAttribute('data-goal');
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
        goalButtons.forEach(function (b) { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
        statusEl.textContent = 'CHEW is thinking...';
        statusEl.classList.remove('is-error');
        resultEl.hidden = true;
        chainEl.classList.remove('is-visible');
        resetHeroField();

        fetch('/api/intelligence-demo?goal=' + encodeURIComponent(btn.getAttribute('data-goal')))
          .then(function (res) {
            if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || 'Lookup failed'); });
            return res.json();
          })
          .then(function (data) {
            statusEl.textContent = '';
            disclaimerEl.textContent = data.disclaimer;
            disclaimerEl.hidden = false;
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
            renderHeroField(data.requirementSequence, rec.basedOnFacts, rec.chosenRequirementKey, rec.recommendedAction, rec.rationale);
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
          })
          .catch(function (err) {
            statusEl.textContent = err.message || 'CHEW couldn\'t load this example right now.';
            statusEl.classList.add('is-error');
          });
      });
    });
  }
});
