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

    goalButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        clearPendingTimeouts();
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
            if (revealReduceMotion) {
              chainEl.classList.add('is-visible');
            } else {
              pendingTimeouts.push(setTimeout(function () { chainEl.classList.add('is-visible'); }, 1150));
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
