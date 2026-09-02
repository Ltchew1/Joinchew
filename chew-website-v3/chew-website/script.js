// CHEW — shared site behavior

document.addEventListener('DOMContentLoaded', function () {
  // Reserved production asset slots (monument hero scene + the four
  // portal renders): until the real files are supplied, each 404s
  // silently and this reveals the adjacent placeholder instead of a
  // broken-image icon. Not a design substitute — the moment the real
  // files land at these paths, this code path never fires again.
  // The browser starts fetching an <img> as soon as the parser sees it,
  // independent of script execution — so a 404 can already have fired
  // its error event before this listener attaches (DOMContentLoaded
  // runs after parsing). Handle that already-failed state synchronously
  // via .complete/.naturalWidth, and still listen for a later failure
  // (e.g. a slow/interrupted load) via the event.
  function wireImageFallback(img, fallback) {
    if (!img || !fallback) return;
    function onFail() { img.hidden = true; fallback.hidden = false; }
    if (img.complete && img.naturalWidth === 0) onFail();
    else img.addEventListener('error', onFail);
  }
  wireImageFallback(document.getElementById('cx-monument-scene'), document.getElementById('cx-monument-fallback'));
  document.querySelectorAll('.cx-portal-icon-img').forEach(function (img) {
    wireImageFallback(img, img.nextElementSibling);
  });

  // Portal sidebar collapse/expand — desktop rail only (see the
  // matching @media (min-width: 901px) block in styles.css). State is
  // applied synchronously by an inline script in the sidebar markup
  // itself before this handler attaches, so there's no expanded-then-
  // collapsed flash on load; this just wires the toggle button.
  var ptSidebar = document.getElementById('pt-sidebar');
  var ptSidebarToggle = document.getElementById('pt-sidebar-toggle');
  if (ptSidebar && ptSidebarToggle) {
    ptSidebarToggle.setAttribute('aria-expanded', String(!ptSidebar.classList.contains('is-collapsed')));
    ptSidebarToggle.addEventListener('click', function () {
      var collapsed = ptSidebar.classList.toggle('is-collapsed');
      ptSidebarToggle.setAttribute('aria-expanded', String(!collapsed));
      ptSidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      try { localStorage.setItem('chewPortalSidebarCollapsed', collapsed ? '1' : '0'); } catch (e) { /* private browsing, etc */ }
    });
  }

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

  // World destination pages — the World Map: stations arranged around
  // a central World Core, with a real (DOM-measured) connecting-route
  // overlay between each station and the core, redrawn on resize so it
  // holds at any breakpoint. Selecting a station illuminates its route
  // and opens the shared Intelligence Drawer instead of expanding in
  // place — same static educational content as before, per-World and
  // never fabricated, just staged as a drawer instead of an accordion.
  (function () {
    var map = document.querySelector('.wp-map');
    if (!map) return;
    var core = map.querySelector('.wm-core');
    var nodes = Array.prototype.slice.call(map.querySelectorAll('.wp-node'));
    var routesSvg = map.querySelector('.wm-routes');

    function drawRoutes() {
      if (!routesSvg || !core || window.innerWidth <= 900) { if (routesSvg) routesSvg.innerHTML = ''; return; }
      var mapRect = map.getBoundingClientRect();
      var coreRect = core.getBoundingClientRect();
      var cx = coreRect.left + coreRect.width / 2 - mapRect.left;
      var cy = coreRect.top + coreRect.height / 2 - mapRect.top;
      routesSvg.innerHTML = '';
      nodes.forEach(function (node, i) {
        var r = node.getBoundingClientRect();
        var nx = r.left + r.width / 2 - mapRect.left;
        var ny = r.top + r.height / 2 - mapRect.top;
        var mx = (cx + nx) / 2, my = (cy + ny) / 2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M ' + cx + ' ' + cy + ' Q ' + mx + ' ' + my + ' ' + nx + ' ' + ny);
        path.dataset.index = String(i);
        routesSvg.appendChild(path);
      });
    }
    drawRoutes();
    window.addEventListener('resize', drawRoutes);
    window.addEventListener('load', drawRoutes);

    var drawer = document.getElementById('wp-drawer');
    if (!drawer) return;
    var els = {
      index: document.getElementById('wp-drawer-index'),
      title: document.getElementById('wp-drawer-title'),
      what: document.getElementById('wp-drawer-what'),
      why: document.getElementById('wp-drawer-why'),
      look: document.getElementById('wp-drawer-look'),
      connects: document.getElementById('wp-drawer-connects'),
      playWrap: document.getElementById('wp-drawer-play'),
      playLink: document.getElementById('wp-drawer-play-link'),
      playName: document.getElementById('wp-drawer-play-name'),
      exploreWrap: document.getElementById('wp-drawer-explore'),
      exploreLink: document.getElementById('wp-drawer-explore-link')
    };
    var closeTimer = null;

    function openDrawer(node, i) {
      nodes.forEach(function (n) { n.classList.remove('is-active'); n.setAttribute('aria-expanded', 'false'); });
      node.classList.add('is-active');
      node.setAttribute('aria-expanded', 'true');
      if (routesSvg) {
        routesSvg.querySelectorAll('path').forEach(function (p) {
          p.classList.toggle('is-lit', Number(p.dataset.index) === i);
        });
      }
      if (els.index) els.index.textContent = node.dataset.index || '';
      if (els.title) els.title.textContent = node.dataset.title || '';
      if (els.what) els.what.textContent = node.dataset.what || '';
      if (els.why) els.why.textContent = node.dataset.why || '';
      if (els.look) els.look.textContent = node.dataset.look || '';
      if (els.connects) els.connects.textContent = node.dataset.connects || '';
      if (els.playWrap) {
        if (node.dataset.play) {
          els.playWrap.hidden = false;
          if (els.playName) els.playName.textContent = node.dataset.play;
          if (els.playLink) els.playLink.href = node.dataset.playHref || 'playbook.html';
        } else {
          els.playWrap.hidden = true;
        }
      }
      if (els.exploreWrap) {
        if (node.dataset.exploreText) {
          els.exploreWrap.hidden = false;
          if (els.exploreLink) {
            els.exploreLink.textContent = node.dataset.exploreText;
            els.exploreLink.href = node.dataset.exploreHref || 'apply.html';
          }
        } else {
          els.exploreWrap.hidden = true;
        }
      }
      if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = null; }
      drawer.hidden = false;
      void drawer.offsetWidth;
      drawer.classList.add('is-open');
      document.body.classList.add('wp-drawer-locked');
    }
    function closeDrawer() {
      drawer.classList.remove('is-open');
      nodes.forEach(function (n) { n.classList.remove('is-active'); n.setAttribute('aria-expanded', 'false'); });
      if (routesSvg) routesSvg.querySelectorAll('path').forEach(function (p) { p.classList.remove('is-lit'); });
      document.body.classList.remove('wp-drawer-locked');
      closeTimer = window.setTimeout(function () { drawer.hidden = true; }, 420);
    }
    nodes.forEach(function (node, i) {
      node.setAttribute('aria-expanded', 'false');
      node.addEventListener('click', function () { openDrawer(node, i); });
    });
    drawer.querySelectorAll('[data-drawer-close]').forEach(function (el) {
      el.addEventListener('click', closeDrawer);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer();
    });
  })();

  // Related Plays row — hovering/focusing a Play medallion swaps in a
  // short "why this matters in this World" note; clicking still
  // navigates straight to the Playbook (the medallion is a real link).
  document.querySelectorAll('.wp-plays-inner').forEach(function (inner) {
    var note = inner.querySelector('.wp-plays-note');
    if (!note) return;
    var defaultText = note.textContent;
    inner.querySelectorAll('.wp-play-medallion').forEach(function (m) {
      var text = m.getAttribute('data-note');
      if (!text) return;
      function show() { note.textContent = text; m.classList.add('is-active'); }
      function hide() { note.textContent = defaultText; m.classList.remove('is-active'); }
      m.addEventListener('mouseenter', show);
      m.addEventListener('focus', show);
      m.addEventListener('mouseleave', hide);
      m.addEventListener('blur', hide);
    });
  });

  // Worlds Hub — the canonical globe artifact as a literal centerpiece,
  // with the eight real World portals arranged around it and a real
  // (DOM-measured) orbital route system connecting them. Hovering a
  // portal lights its route and previews — as a gentle highlight, not
  // the full click-selection state — which Life Map categories that
  // World conceptually touches (the same disclosed illustrative sample
  // data already on this page, not real visitor facts).
  (function () {
    var diagram = document.querySelector('.wh-diagram');
    if (!diagram) return;
    var core = diagram.querySelector('.wh-core');
    var portals = Array.prototype.slice.call(diagram.querySelectorAll('.wh-portal'));
    var svg = diagram.querySelector('.wh-routes');

    function draw() {
      if (!svg || !core || window.innerWidth <= 900) { if (svg) svg.innerHTML = ''; return; }
      var dRect = diagram.getBoundingClientRect();
      var cRect = core.getBoundingClientRect();
      var cx = cRect.left + cRect.width / 2 - dRect.left;
      var cy = cRect.top + cRect.height / 2 - dRect.top;
      svg.innerHTML = '';
      portals.forEach(function (p, i) {
        var r = p.getBoundingClientRect();
        var nx = r.left + r.width / 2 - dRect.left;
        var ny = r.top + r.height / 2 - dRect.top;
        var mx = (cx + nx) / 2, my = (cy + ny) / 2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M ' + cx + ' ' + cy + ' Q ' + mx + ' ' + my + ' ' + nx + ' ' + ny);
        path.dataset.index = String(i);
        svg.appendChild(path);
      });
    }
    draw();
    window.addEventListener('resize', draw);
    window.addEventListener('load', draw);

    var lifemapWrap = document.getElementById('lifemap-wrap');
    var WORLD_TERRITORIES = {
      home: ['liquidity', 'credit', 'ownership'],
      drive: ['liquidity', 'credit'],
      build: ['business', 'capital', 'credit'],
      property: ['property', 'capital', 'ownership'],
      levelup: ['business', 'assets'],
      go: ['liquidity'],
      celebrate: ['liquidity', 'insurance'],
      protect: ['insurance', 'assets', 'liquidity']
    };
    portals.forEach(function (p, i) {
      var key = p.getAttribute('data-world');
      function light() {
        if (svg) svg.querySelectorAll('path').forEach(function (path) { path.classList.toggle('is-lit', Number(path.dataset.index) === i); });
        if (lifemapWrap && key && WORLD_TERRITORIES[key]) {
          WORLD_TERRITORIES[key].forEach(function (t) {
            lifemapWrap.querySelectorAll('[data-territory="' + t + '"]').forEach(function (el) { el.classList.add('is-hub-preview'); });
          });
        }
      }
      function unlight() {
        if (svg) svg.querySelectorAll('path').forEach(function (path) { path.classList.remove('is-lit'); });
        if (lifemapWrap) lifemapWrap.querySelectorAll('.is-hub-preview').forEach(function (el) { el.classList.remove('is-hub-preview'); });
      }
      p.addEventListener('mouseenter', light);
      p.addEventListener('focus', light);
      p.addEventListener('mouseleave', unlight);
      p.addEventListener('blur', unlight);
    });
  })();

  // Playbook's left sidebar — off-canvas on mobile, toggled the same way
  // the shared .nav-toggle works, just a separate element since this
  // page replaces the shared header with its own persistent rail.
  var pbcToggle = document.getElementById('pbc-mobile-toggle');
  var pbcSidebar = document.getElementById('pbc-sidebar');
  var pbcScrim = document.getElementById('pbc-sidebar-scrim');
  if (pbcToggle && pbcSidebar) {
    function pbcCloseSidebar() {
      pbcSidebar.classList.remove('is-open');
      pbcToggle.setAttribute('aria-expanded', 'false');
      if (pbcScrim) pbcScrim.classList.remove('is-visible');
    }
    pbcToggle.addEventListener('click', function () {
      var isOpen = pbcSidebar.classList.toggle('is-open');
      pbcToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (pbcScrim) pbcScrim.classList.toggle('is-visible', isOpen);
    });
    if (pbcScrim) pbcScrim.addEventListener('click', pbcCloseSidebar);
    pbcSidebar.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', pbcCloseSidebar); });
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

  // Magnetic CTAs: the button leans toward the cursor within a small
  // radius and snaps back on leave. Skipped under reduced-motion and
  // on touch (no hover concept to be magnetic toward).
  if (!reduceMotion && window.matchMedia && !window.matchMedia('(hover: none)').matches) {
    document.querySelectorAll('.btn-magnetic').forEach(function (btn) {
      var strength = 0.35;
      btn.addEventListener('mousemove', function (e) {
        var rect = btn.getBoundingClientRect();
        var relX = e.clientX - (rect.left + rect.width / 2);
        var relY = e.clientY - (rect.top + rect.height / 2);
        btn.style.transform = 'translate(' + (relX * strength).toFixed(1) + 'px, ' + (relY * strength).toFixed(1) + 'px)';
      });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
    });
  }

  // Hero field parallax tilt: the intelligence field responds to the
  // cursor with real 3D depth. Desktop hover-capable only; reduced-motion
  // and touch devices get the flat, static panel.
  var hxFieldWrapForTilt = document.getElementById('hx-field-wrap');
  if (hxFieldWrapForTilt && !reduceMotion && window.matchMedia && !window.matchMedia('(hover: none)').matches) {
    hxFieldWrapForTilt.addEventListener('mousemove', function (e) {
      var rect = hxFieldWrapForTilt.getBoundingClientRect();
      var px = (e.clientX - rect.left) / rect.width - 0.5;
      var py = (e.clientY - rect.top) / rect.height - 0.5;
      hxFieldWrapForTilt.style.transform = 'perspective(900px) rotateY(' + (px * 6).toFixed(2) + 'deg) rotateX(' + (py * -6).toFixed(2) + 'deg)';
    });
    hxFieldWrapForTilt.addEventListener('mouseleave', function () { hxFieldWrapForTilt.style.transform = ''; });
  }

  // Room-grid constellation: the one-shot connector pulse fires the
  // first time the room grid enters view, not on every scroll past it.
  var roomGridWrapEl = document.getElementById('room-grid-wrap');
  if (roomGridWrapEl && 'IntersectionObserver' in window) {
    var roomGridObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          roomGridWrapEl.classList.add('is-lit');
          roomGridObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    roomGridObserver.observe(roomGridWrapEl);
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

  // "Click the door" behavior — a shared cinematic beat (the artifact
  // glows, a brief gold flash plays) before navigating to a real
  // destination page. Shared by the homepage's four doors and the
  // Worlds hub's eight World cards, which now route to their own
  // dedicated pages instead of opening an in-page preview.
  (function () {
    var portalCards = document.querySelectorAll('.cx-portal-card, .wh-portal');
    var launchFlash = document.getElementById('cx-portal-launch-flash');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function playLaunchFlash(card) {
      if (card) {
        card.classList.add('is-launching');
        window.setTimeout(function () { card.classList.remove('is-launching'); }, 500);
      }
      if (launchFlash && !reduceMotion) {
        launchFlash.classList.remove('is-active');
        void launchFlash.offsetWidth;
        launchFlash.classList.add('is-active');
      }
    }

    portalCards.forEach(function (card) {
      var href = card.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      card.addEventListener('click', function (e) {
        e.preventDefault();
        playLaunchFlash(card);
        window.setTimeout(function () { window.location.href = href; }, reduceMotion ? 0 : 320);
      });
    });
  })();

  // The Playbook — a radial "board" of eight real decision frameworks
  // around a central hub. Selecting a marker drives one shared stage:
  // a hook line, a hand-built SVG "signature" for that Play's shape,
  // and progressive disclosure for the deeper explanation. The content
  // (all eight frameworks, and the two real links out to Domino/
  // Future-Back) is unchanged from the original build — only the
  // presentation is new.
  var pb2Board = document.getElementById('pb2-board');
  var pb2Ring = document.getElementById('pb2-ring');
  var pb2Stage = document.getElementById('pb2-stage');
  if (pb2Board && pb2Ring && pb2Stage) {
    var pb2ReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var pb2Markers = Array.prototype.slice.call(pb2Ring.querySelectorAll('.pb2-marker'));
    var pb2Spokes = Array.prototype.slice.call(pb2Ring.querySelectorAll('.pb2-spoke'));
    var pb2StageIndex = document.getElementById('pb2-stage-index');
    var pb2StageName = document.getElementById('pb2-stage-name');
    var pb2StageHook = document.getElementById('pb2-stage-hook');
    var pb2Sig = document.getElementById('pb2-sig');
    var pb2RunBtn = document.getElementById('pb2-run');
    var pb2ConnectBtn = document.getElementById('pb2-connect');
    var pb2Deep = document.getElementById('pb2-deep');
    var pb2DeepText = document.getElementById('pb2-deep-text');
    var pb2DeepLink = document.getElementById('pb2-deep-link');
    var pb2ConnectPanel = document.getElementById('pb2-connect-panel');
    var pb2ConnectLabel = document.getElementById('pb2-connect-label');
    var pb2ConnectChips = document.getElementById('pb2-connect-chips');
    var pb2PrevBtn = document.getElementById('pb2-prev');
    var pb2NextBtn = document.getElementById('pb2-next');
    var pb2Dots = document.getElementById('pb2-dots');
    var pbcRailPlayName = document.getElementById('pbc-rail-play-name');
    var pbcRailChips = document.getElementById('pbc-rail-chips');
    var pbcRailInsight = document.getElementById('pbc-rail-insight');
    var pbcStripCards = Array.prototype.slice.call(document.querySelectorAll('.pbc-strip-card'));

    var PB2_PLAYS = [
      {
        key: 'wait', name: 'The Wait Play',
        hook: 'Sometimes the strongest move<br>is the one you don&rsquo;t make yet.',
        deep: 'Not every open door should be walked through immediately. Sometimes the strongest move is holding position until a requirement resolves on its own — a document ages into validity, a balance clears, a season passes.',
        connectChips: ['Home', 'Property', 'Build'],
        sig: '<path class="pb2-sig-path" d="M20,45 H280"/>'
          + '<path class="pb2-sig-pulse pb2-wait-pulse" d="M20,45 H280" stroke-dasharray="46 480"/>'
          + '<rect class="pb2-sig-node" x="140" y="33" width="6" height="24" rx="1.5"/>'
          + '<rect class="pb2-sig-node" x="152" y="33" width="6" height="24" rx="1.5"/>'
          + '<circle class="pb2-sig-node" cx="20" cy="45" r="5"/>'
          + '<circle class="pb2-sig-node is-lit" cx="280" cy="45" r="5"/>'
      },
      {
        key: 'stack', name: 'The Stack Play',
        hook: 'No single move clears it.<br>Three small ones, in order, do.',
        deep: "No single move clears the barrier, but three small ones in the right order do. CHEW's job is finding the order, not just the moves.",
        connectChips: ['Build', 'Level Up', 'Protect'],
        sig: '<path class="pb2-sig-path" d="M20,15 L150,45 M20,45 H150 M20,75 L150,45 M150,45 H280"/>'
          + '<path class="pb2-sig-pulse pb2-stack-a" d="M20,15 L150,45" stroke-dasharray="24 200"/>'
          + '<path class="pb2-sig-pulse pb2-stack-b" d="M20,45 H150" stroke-dasharray="24 200"/>'
          + '<path class="pb2-sig-pulse pb2-stack-c" d="M20,75 L150,45" stroke-dasharray="24 200"/>'
          + '<circle class="pb2-sig-node pb2-stack-hub" cx="150" cy="45" r="5"/>'
          + '<path class="pb2-sig-pulse pb2-stack-out" d="M150,45 H280" stroke-dasharray="38 300"/>'
          + '<circle class="pb2-sig-node is-lit" cx="280" cy="45" r="5"/>'
      },
      {
        key: 'switch', name: 'The Switch Play',
        hook: 'The destination stays the same.<br>The route changes.',
        deep: "When the first path is blocked, the goal doesn't have to change — the requirement sequence does. Same finish line, different first step.",
        connectChips: ['Drive', 'Go', 'Build'],
        sig: '<circle class="pb2-sig-node" cx="20" cy="45" r="5"/>'
          + '<path class="pb2-sig-path" d="M20,45 C70,20 90,20 130,20"/>'
          + '<line x1="130" y1="8" x2="130" y2="34" stroke="var(--text-faint)" stroke-width="2"/>'
          + '<path class="pb2-sig-path" d="M20,45 C70,70 200,70 280,45"/>'
          + '<path class="pb2-sig-pulse" d="M20,45 C70,70 200,70 280,45" stroke-dasharray="48 480"/>'
          + '<circle class="pb2-sig-node is-lit" cx="280" cy="45" r="5"/>'
      },
      {
        key: 'buffer', name: 'The Buffer Play',
        hook: 'Speed isn&rsquo;t always the win.<br>Slack is a position too.',
        deep: 'Speed is not always the win. Sometimes the correct move is building slack into the position before committing it anywhere.',
        connectChips: ['Protect', 'Home', 'Celebrate'],
        sig: '<circle class="pb2-sig-node is-lit" cx="30" cy="45" r="5"/>'
          + '<path class="pb2-sig-pulse" d="M30,45 H60" stroke-dasharray="18 40"/>'
          + '<rect class="pb2-sig-node pb2-buffer-band" x="60" y="20" width="140" height="50" rx="6"/>'
          + '<path class="pb2-sig-path" d="M220,45 L235,25 L250,55 L265,30 L280,45"/>'
      },
      {
        key: 'leverage', name: 'The Leverage Play',
        hook: 'Something already yours<br>can move the next thing.',
        deep: 'Not everything has to be built from zero. Sometimes the leverage already exists in the position — it just has not been pointed at anything yet.',
        connectChips: ['Build', 'Property', 'Go'],
        sig: '<circle class="pb2-sig-node is-lit" cx="40" cy="45" r="6"/>'
          + '<path class="pb2-sig-path" d="M40,45 H180"/>'
          + '<path class="pb2-sig-pulse" d="M40,45 H180" stroke-dasharray="32 300"/>'
          + '<circle class="pb2-sig-node pb2-leverage-target" cx="180" cy="45" r="6"/>'
          + '<path class="pb2-sig-path" d="M180,45 H280"/>'
          + '<circle class="pb2-sig-node is-lit" cx="280" cy="45" r="5"/>'
      },
      {
        key: 'domino', name: 'The Domino Play',
        hook: 'One move.<br>Multiple Worlds react.',
        deep: 'Nothing in the Eight Worlds sits in isolation. A move made for one goal can quietly change the requirements for another.',
        connectHref: '#cx-worlds', connectLabel: 'See a real domino run above →',
        sig: '<line class="pb2-sig-path" x1="20" y1="60" x2="280" y2="60"/>'
          + '<rect class="pb2-sig-node pb2-domino-tile" x="40" y="30" width="10" height="30" style="animation-delay:0s"/>'
          + '<rect class="pb2-sig-node pb2-domino-tile" x="85" y="30" width="10" height="30" style="animation-delay:0.16s"/>'
          + '<rect class="pb2-sig-node pb2-domino-tile" x="130" y="30" width="10" height="30" style="animation-delay:0.32s"/>'
          + '<rect class="pb2-sig-node pb2-domino-tile" x="175" y="30" width="10" height="30" style="animation-delay:0.48s"/>'
          + '<rect class="pb2-sig-node pb2-domino-tile" x="220" y="30" width="10" height="30" style="animation-delay:0.64s"/>'
      },
      {
        key: 'cleanup', name: 'The Cleanup Play',
        hook: 'Remove friction<br>before adding complexity.',
        deep: "Before stacking a new goal on top of the position, CHEW checks what's already dragging on the current one. Cleanup first, then build.",
        connectChips: ['Protect', 'Home', 'Level Up'],
        sig: '<path class="pb2-sig-path" d="M20,45 H280"/>'
          + '<path class="pb2-sig-pulse" d="M20,45 H280" stroke-dasharray="56 480"/>'
          + '<g class="pb2-cleanup-ticks">'
          + '<line x1="70" y1="35" x2="76" y2="55" style="animation-delay:0s"/>'
          + '<line x1="110" y1="55" x2="116" y2="35" style="animation-delay:0.15s"/>'
          + '<line x1="150" y1="35" x2="156" y2="55" style="animation-delay:0.3s"/>'
          + '<line x1="190" y1="55" x2="196" y2="35" style="animation-delay:0.45s"/>'
          + '</g>'
          + '<circle class="pb2-sig-node is-lit" cx="280" cy="45" r="5"/>'
      },
      {
        key: 'futureback', name: 'The Future-Back Play',
        hook: 'The destination comes first.<br>The path builds backward.',
        deep: 'Instead of asking "what can I do today," start from the goal and walk backward to today, requirement by requirement.',
        connectHref: 'future-room.html', connectLabel: 'Walk a real one backward (early preview) →',
        sig: '<circle class="pb2-sig-node is-lit" cx="280" cy="45" r="6"/>'
          + '<path class="pb2-sig-path" d="M20,45 H280"/>'
          + '<path class="pb2-sig-pulse" d="M280,45 H20" stroke-dasharray="46 480"/>'
          + '<circle class="pb2-sig-node pb2-fb-start" cx="20" cy="45" r="6"/>'
      }
    ];

    pb2Dots.innerHTML = PB2_PLAYS.map(function () { return '<span class="pb2-dot"></span>'; }).join('');
    var pb2DotEls = Array.prototype.slice.call(pb2Dots.querySelectorAll('.pb2-dot'));
    var pb2ActiveIndex = 0;

    function pb2Select(index, focusMarker) {
      pb2ActiveIndex = (index + PB2_PLAYS.length) % PB2_PLAYS.length;
      var play = PB2_PLAYS[pb2ActiveIndex];

      pb2Ring.classList.add('has-selection');
      pb2Markers.forEach(function (m, i) {
        var active = i === pb2ActiveIndex;
        m.classList.toggle('is-active', active);
        m.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      pb2Spokes.forEach(function (s, i) { s.classList.toggle('is-active-line', i === pb2ActiveIndex); });
      pb2DotEls.forEach(function (d, i) { d.classList.toggle('is-active', i === pb2ActiveIndex); });
      pbcStripCards.forEach(function (c, i) { c.classList.toggle('is-active', i === pb2ActiveIndex); });

      // Right rail — real data only: this Play's own name, its real
      // World connections (or its one real cross-link), and an excerpt
      // of its real deep-dive explanation. No fabricated readiness
      // score, mastery count, or personal sequence history.
      if (pbcRailPlayName) pbcRailPlayName.textContent = play.name;
      if (pbcRailChips) {
        pbcRailChips.innerHTML = (play.connectChips || []).map(function (name) {
          return '<span class="pbc-rail-chip">' + name + '</span>';
        }).join('') || (play.connectLabel ? '<span class="pbc-rail-chip pbc-rail-chip--link">' + play.connectLabel + '</span>' : '');
      }
      if (pbcRailInsight) pbcRailInsight.textContent = play.deep;

      pb2StageIndex.textContent = 'Play ' + String(pb2ActiveIndex + 1).padStart(2, '0');
      pb2StageName.textContent = play.name;
      pb2StageHook.innerHTML = play.hook;
      pb2Sig.innerHTML = play.sig;

      pb2DeepText.textContent = play.deep;
      if (play.connectHref) {
        pb2DeepLink.href = play.connectHref;
        pb2DeepLink.textContent = play.connectLabel;
        pb2DeepLink.hidden = false;
      } else {
        pb2DeepLink.hidden = true;
      }
      pb2Deep.hidden = true;
      pb2Deep.classList.remove('is-visible');
      pb2RunBtn.setAttribute('aria-expanded', 'false');
      pb2RunBtn.textContent = 'Run This Play →';
      pb2ConnectPanel.hidden = true;
      pb2ConnectPanel.classList.remove('is-visible');
      pb2ConnectChips.innerHTML = '';

      if (focusMarker) pb2Markers[pb2ActiveIndex].focus();
    }

    pb2Markers.forEach(function (marker, i) {
      marker.addEventListener('click', function () { pb2Select(i, false); });
    });

    pb2Ring.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); pb2Select(pb2ActiveIndex + 1, true); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); pb2Select(pb2ActiveIndex - 1, true); }
    });

    pb2PrevBtn.addEventListener('click', function () { pb2Select(pb2ActiveIndex - 1, false); });
    pb2NextBtn.addEventListener('click', function () { pb2Select(pb2ActiveIndex + 1, false); });

    pb2RunBtn.addEventListener('click', function () {
      var open = pb2Deep.hidden;
      pb2Deep.hidden = !open;
      pb2RunBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      pb2RunBtn.textContent = open ? 'Hide This Play' : 'Run This Play →';
      if (open) requestAnimationFrame(function () { pb2Deep.classList.add('is-visible'); });
      else pb2Deep.classList.remove('is-visible');
    });

    pb2ConnectBtn.addEventListener('click', function () {
      var play = PB2_PLAYS[pb2ActiveIndex];
      if (play.connectHref) {
        if (play.connectHref.charAt(0) === '#') {
          var target = document.querySelector(play.connectHref);
          if (target) target.scrollIntoView({ block: 'center', behavior: pb2ReduceMotion ? 'auto' : 'smooth' });
        } else {
          window.location.href = play.connectHref;
        }
        return;
      }
      var isOpen = !pb2ConnectPanel.hidden;
      if (isOpen) {
        pb2ConnectPanel.hidden = true;
        pb2ConnectPanel.classList.remove('is-visible');
        return;
      }
      pb2ConnectLabel.textContent = 'Where a play like this tends to show up — illustrative, not a live calculation for your position.';
      pb2ConnectChips.innerHTML = (play.connectChips || []).map(function (name, i) {
        return '<span class="pb2-chip" style="animation-delay:' + (i * 0.08) + 's">' + name + '</span>';
      }).join('');
      pb2ConnectPanel.hidden = false;
      requestAnimationFrame(function () { pb2ConnectPanel.classList.add('is-visible'); });
    });

    // Lower Play strip — "Explore" reuses the exact same real selection
    // and deep-dive panel as the board above; it never renders its own
    // copy of the content.
    document.querySelectorAll('.pbc-strip-explore').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-explore'), 10);
        pb2Select(idx, false);
        pb2Stage.scrollIntoView({ block: 'center', behavior: pb2ReduceMotion ? 'auto' : 'smooth' });
        if (pb2Deep.hidden) pb2RunBtn.click();
      });
    });

    pb2Select(0, false);
  }

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
    var cstEl = document.getElementById('chew-saw-that');
    var cstHeadlineEl = document.getElementById('cst-headline');
    var cstFactsEl = document.getElementById('cst-facts');
    var cstWhyToggle = document.getElementById('cst-why-toggle');
    var cstWhyBody = document.getElementById('cst-why-body');
    if (cstWhyToggle) {
      cstWhyToggle.addEventListener('click', function () {
        var open = cstWhyBody.classList.toggle('is-open');
        cstWhyToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        cstWhyToggle.textContent = open ? 'Hide the reasoning' : 'Show me why →';
      });
    }
    // "CHEW Saw That" — built from the exact same basedOnFacts/rationale
    // the reveal-chain above already fetched, presented as a state-change
    // flourish. No second data source, no invented numbers.
    function renderChewSawThat(rec, goalTitle) {
      if (!cstEl) return;
      var keys = Object.keys(rec.basedOnFacts || {});
      cstHeadlineEl.textContent = goalTitle ? 'Position changed: ' + goalTitle + '.' : 'Position changed.';
      cstFactsEl.innerHTML = keys.map(function (key) {
        var fact = rec.basedOnFacts[key];
        var cls = fact.met ? 'cst-fact cst-fact--met' : 'cst-fact cst-fact--unmet';
        var mark = fact.met ? '✓ ' : '— ';
        return '<span class="' + cls + '">' + mark + escapeHtml(formatFactKey(key)) + '</span>';
      }).join('');
      cstWhyBody.textContent = rec.rationale || '';
      cstWhyBody.classList.remove('is-open');
      cstWhyToggle.setAttribute('aria-expanded', 'false');
      cstWhyToggle.textContent = 'Show me why →';
      cstEl.hidden = false;
      requestAnimationFrame(function () { cstEl.classList.add('is-visible'); });
    }
    var cxWorldEls = document.querySelectorAll('.cx-world');

    // The only two mappings the real demo legitimately supports. Home and
    // Property are deliberately separate CHEW Worlds — Home is the
    // primary-residence goal ("buy a first home"), Property is the
    // broader investment/commercial real-asset destination — so the
    // "buy a home" scenario maps to Home, not Property. The "business
    // funding-ready" scenario maps to Build. The other six Worlds have no
    // demo-backed goal yet, so they are deliberately absent from this map
    // rather than guessed at.
    var GOAL_TO_WORLD = { home: 'home', funding: 'build' };

    // Genuine reaction, not a fabricated one: light the real CHEW World
    // the just-returned recommendation actually corresponds to. No
    // invented data — just a real fact (the selected goal) driving a
    // real UI state, and only where a safe/direct mapping exists.
    function lightMatchingWorld(goal) {
      cxWorldEls.forEach(function (el) { el.classList.remove('is-lit'); });
      var worldKey = goal && GOAL_TO_WORLD[goal];
      if (!worldKey) return;
      var target = document.querySelector('.cx-world[data-world="' + worldKey + '"]');
      if (target) target.classList.add('is-lit');
    }

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
            if (edge) {
              edge.classList.add('is-chosen-edge');
              // Barrier Engine: a real physical obstruction glyph placed on
              // the one route this example's own engine actually flagged
              // (chosenRequirementKey) — geometry only, drawn from the same
              // hub/node coordinates renderHeroField already computed, not
              // a second data source or a decorative flourish on every edge.
              var bPos = nodePosition(chosenIndex, total);
              var bx = HX_HUB_X + (bPos.x - HX_HUB_X) * 0.6;
              var by = HX_HUB_Y + (bPos.y - HX_HUB_Y) * 0.6;
              var dx = bPos.x - HX_HUB_X, dy = bPos.y - HX_HUB_Y;
              var len = Math.sqrt(dx * dx + dy * dy) || 1;
              var ux = dx / len, uy = dy / len;
              var bAngle = Math.atan2(dy, dx) * 180 / Math.PI;
              // The route itself physically breaks at the barrier point —
              // two real segments with a gap, not one continuous line with
              // a decal on top — so the obstruction reads without any text.
              var gap = 17;
              edge.setAttribute('d', 'M' + HX_HUB_X + ',' + HX_HUB_Y + ' L' + (bx - ux * gap).toFixed(1) + ',' + (by - uy * gap).toFixed(1));
              var farSeg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              farSeg.setAttribute('class', 'hx-edge is-chosen-edge');
              farSeg.setAttribute('d', 'M' + (bx + ux * gap).toFixed(1) + ',' + (by + uy * gap).toFixed(1) + ' L' + bPos.x.toFixed(1) + ',' + bPos.y.toFixed(1));
              hxFieldSvgEl.appendChild(farSeg);
              var gate = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              gate.setAttribute('class', 'hx-barrier-glyph');
              gate.setAttribute('transform', 'translate(' + bx.toFixed(1) + ',' + by.toFixed(1) + ') rotate(' + (bAngle + 90).toFixed(1) + ')');
              gate.innerHTML = '<line class="hx-barrier-bar" x1="-16" y1="0" x2="16" y2="0"/>'
                + '<circle class="hx-barrier-post" cx="-16" cy="0" r="3"/>'
                + '<circle class="hx-barrier-post" cx="16" cy="0" r="3"/>';
              hxFieldSvgEl.appendChild(gate);
            }
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
      var stagesHtml = '<div class="futureback-stage futureback-stage--goal" role="listitem" data-index="0">'
        + '<span class="futureback-stage-eyebrow">The Real Goal</span>'
        + '<span class="futureback-stage-label">' + escapeHtml(goalLabel) + '</span>'
        + '</div>';

      if (chosenIndex === -1) {
        stagesHtml += '<span class="futureback-trace-seg" aria-hidden="true"></span>'
          + '<div class="futureback-stage futureback-stage--today" role="listitem" data-index="1">'
          + '<span class="futureback-stage-eyebrow">Today</span>'
          + '<span class="futureback-stage-label">Every real requirement for this goal is already met in this example.</span>'
          + '</div>';
        futurebackChainEl.innerHTML = stagesHtml;
        futurebackChainEl.hidden = false;
        var onlyStage = futurebackChainEl.querySelectorAll('.futureback-stage');
        onlyStage.forEach(function (el) { el.classList.add('is-visible'); });
        var onlyTrace = futurebackChainEl.querySelector('.futureback-trace-seg');
        if (onlyTrace) onlyTrace.classList.add('is-lit');
        return;
      }

      var forward = lastRequirementSequence.slice(chosenIndex).slice().reverse();
      var resolved = lastRequirementSequence.slice(0, chosenIndex);

      forward.forEach(function (tile, i) {
        var isToday = i === forward.length - 1;
        stagesHtml += '<span class="futureback-trace-seg" data-trace-index="' + i + '" aria-hidden="true"></span>';
        stagesHtml += '<div class="futureback-stage' + (isToday ? ' futureback-stage--today' : '') + '" role="listitem" data-index="' + (i + 1) + '">'
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
      var traceEls = futurebackChainEl.querySelectorAll('.futureback-trace-seg');
      stageEls.forEach(function (el, i) {
        var reveal = function () {
          el.classList.add('is-visible');
          // traceEls[i - 1] is the hairline directly above this stage (the
          // goal stage at i=0 has none) — light it the moment this stage
          // becomes the walked-to waypoint, so the trace lights in step
          // with the path being traced, not all at once.
          if (traceEls[i - 1]) traceEls[i - 1].classList.add('is-lit');
        };
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
        if (cstEl) { cstEl.hidden = true; cstEl.classList.remove('is-visible'); }
        resetHeroField();
        lightMatchingWorld(null);

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
            lightMatchingWorld(btn.getAttribute('data-goal'));
            lastRequirementSequence = data.requirementSequence || null;
            lastBasedOnFacts = rec.basedOnFacts;
            lastChosenRequirementKey = rec.chosenRequirementKey;
            lastCapabilityOverview = data.capabilityOverview || null;
            lastGoalTitle = data.goalTitle || null;
            if (revealReduceMotion) {
              chainEl.classList.add('is-visible');
              renderChewSawThat(rec, data.goalTitle);
              dominoSectionEl.hidden = false;
              radarSectionEl.hidden = false;
              futurebackSectionEl.hidden = false;
            } else {
              pendingTimeouts.push(setTimeout(function () { chainEl.classList.add('is-visible'); }, 1700));
              pendingTimeouts.push(setTimeout(function () { renderChewSawThat(rec, data.goalTitle); }, 2000));
              pendingTimeouts.push(setTimeout(function () { dominoSectionEl.hidden = false; }, 2300));
              pendingTimeouts.push(setTimeout(function () { radarSectionEl.hidden = false; }, 2600));
              pendingTimeouts.push(setTimeout(function () { futurebackSectionEl.hidden = false; }, 2900));
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

// ---------- CHEW Deal Sheet — shared render helper ----------
// Used by sign-agreement.html and pay-remainder.html. Pure rendering: the
// caller fetches real data (from /api/deal-sheet, or a real program_purchases
// row for the remainder-balance case) and passes it in — this function never
// invents a value itself, it only writes whatever string it's given into the
// matching field.
function chewRenderDealSheet(root, fields) {
  if (!root) return;
  var map = {
    'ds-product': fields.product,
    'ds-price': fields.price,
    'ds-billing': fields.billing,
    'ds-provides': fields.provides,
    'ds-not-promise': fields.notPromise,
    'ds-cancel': fields.cancellation,
    'ds-refund': fields.refund,
    'ds-next': fields.next,
  };
  Object.keys(map).forEach(function (id) {
    var el = root.querySelector('#' + id);
    if (el && map[id] != null) el.textContent = map[id];
  });
}

function chewFormatCents(cents) {
  if (cents == null) return '';
  var dollars = cents / 100;
  var hasCents = cents % 100 !== 0;
  return '$' + dollars.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}
