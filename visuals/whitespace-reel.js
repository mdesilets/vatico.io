/* ============================================================
   whitespace-reel.js — MapLibre-based "Dataset Depth" reel

   The pitch: 52,000+ aesthetic-medicine practices, six verticals,
   nationwide down to a single Manhattan block.

   This rewrite drops the canvas + Albers-projection pipeline and
   uses MapLibre GL with CARTO's Dark Matter GL vector style — the
   same basemap the production Consumer Finder uses. Picking it up
   for free gets us state borders, county boundaries, road networks,
   water, and zoom-aware place labels — without that geographic
   substrate the dots floated in a void, and the third zoom (a
   neighborhood) was unreadable.

   On top of MapLibre we add:
     - source 'practices': all 52K dots as GeoJSON Points
     - layer 'practice-dots': one circle layer with a paint case-
       expression that toggles which vertical is "active" each beat
     - source 'dmas': Nielsen DMA boundaries
     - layer 'dma-borders': hairline outlines, only visible at the
       country zoom (faded out by 7+ to keep the metro/neighborhood
       views uncluttered)

   Camera is driven by map.flyTo() between beats. We do NOT use the
   reel-engine — that one is canvas-bound. Instead we run a small
   inline rAF scheduler with the same patterns (visibilitychange
   pause/resume, prefers-reduced-motion fallback, card crossfade).
   ============================================================ */

(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------

  // CARTO Dark Matter GL — same vector style the production
  // Consumer Finder uses (consumer-finder-deck-map.tsx::BASEMAP_STYLE).
  // Free for commercial use with attribution; we credit in the footer.
  const STYLE_URL      = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const BUNDLE_URL     = 'data/whitespace-reel.json?v=4';
  const LOCATIONS_URL  = (window.innerWidth < 768
                            ? 'data/locations.anon.mobile.json'
                            : 'data/locations.anon.json') + '?v=3';
  const BOUNDARIES_URL = 'data/dma-boundaries.geojson?v=2';

  // Beat durations. Bumped from the v1 pacing — Mike's feedback was
  // it felt too snappy; the dataset deserves a beat to land.
  const OPEN_MS = 2000;
  const SOLO_MS = 2300;
  const ALL_MS  = 3300;
  const FLY_MS  = 2700;   // camera transition between zoom levels

  // How long the per-dot cascade-in takes when a beat changes. Each
  // feature carries a randomized `seq` (0..N) assigned at boot; the
  // cascade animates an opacity gate over seq so dots stream in
  // organically instead of all flipping on at once.
  const CASCADE_MS = 800;

  // Per-zoom MapLibre camera. fitBounds (with the bbox we already
  // ship in the bundle) would also work, but explicit center+zoom
  // gives more stable framing on different aspect ratios.
  //
  // Country zoom has two framings:
  //   landscape (16:9, desktop, phone rotated, tablet wide) →
  //     CONUS-centered shot
  //   portrait  (9:16, phone held normally, tablet portrait) →
  //     east-coast-centered shot. That's where ~80% of the
  //     practice density lives; centering on Kansas in a tall
  //     frame leaves the meaningful cluster crammed against
  //     one edge.
  //
  // NYC and Manhattan are east-coast already, so the same
  // centers work in either orientation.
  const IS_PORTRAIT = window.innerHeight > window.innerWidth;

  const CAMERA = IS_PORTRAIT
    ? {
        country:   { center: [-79.0,   37.0],  zoom: 4.05 },
        nyc:       { center: [-73.95,  40.78], zoom: 8.2  },
        manhattan: { center: [-73.975, 40.78], zoom: 11.6 },
      }
    : {
        country:   { center: [-96.5,   38.5],  zoom: 3.6  },
        nyc:       { center: [-73.85,  40.85], zoom: 8.6  },
        manhattan: { center: [-73.975, 40.78], zoom: 12.0 },
      };

  // Color per vertical id. Sourced authoritatively from the bundle
  // at boot — these mirror the production map and are only fallbacks.
  const FALLBACK_COLORS = {
    injectable:      '#3B82F6',
    laser:           '#EC4899',
    body_contouring: '#F97316',
    skin_treatment:  '#10B981',
    wellness:        '#A855F7',
    cosmetic:        '#94A3B8',
  };

  const REDUCED_MOTION = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Set at boot from the loaded GeoJSON. Needed by the cascade
  // animation to map the eased 0..1 progress onto a `seq` threshold.
  let TOTAL_DOTS = 0;
  let cascadeRAF = null;

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  function init() {
    if (typeof maplibregl === 'undefined') {
      bail('MapLibre GL failed to load');
      return;
    }

    Promise.all([
      fetch(BUNDLE_URL).then(r => r.json()),
      fetch(LOCATIONS_URL).then(r => r.json()),
      fetch(BOUNDARIES_URL).then(r => r.json()),
    ]).then(out => build(out[0], out[1], out[2]))
      .catch(err => bail('data load failed: ' + (err && err.message || err)));
  }

  function bail(msg) {
    console.error('[whitespace-reel]', msg);
    const veil = document.getElementById('whitespace-loading');
    if (veil) {
      veil.textContent = msg;
      veil.style.color = '#e74c3c';
    }
  }

  function build(bundle, locations, boundaries) {
    const cardSlot = document.getElementById('whitespace-card');

    const verticals = bundle.verticals;
    const colorById = {};
    for (let i = 0; i < verticals.length; i++) {
      colorById[verticals[i].id] = verticals[i].color || FALLBACK_COLORS[verticals[i].id];
    }

    // Build a GeoJSON FeatureCollection from the compact location
    // list. Each feature gets a randomized `seq` (0..N-1) — used by
    // the cascade animation as a per-dot reveal index. Fisher-Yates
    // shuffle keeps the cascade order organic (no geographic bias,
    // no vertical bias).
    const N = locations.length;
    const seqOrder = new Uint32Array(N);
    for (let i = 0; i < N; i++) seqOrder[i] = i;
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = seqOrder[i]; seqOrder[i] = seqOrder[j]; seqOrder[j] = tmp;
    }

    const practices = {
      type: 'FeatureCollection',
      features: new Array(N),
    };
    for (let i = 0; i < N; i++) {
      const p = locations[i];
      practices.features[i] = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { v: p.v, seq: seqOrder[i] },
      };
    }
    TOTAL_DOTS = N;

    const map = new maplibregl.Map({
      container: 'whitespace-map',
      style: STYLE_URL,
      center: CAMERA.country.center,
      zoom: CAMERA.country.zoom,
      attributionControl: false,
      interactive: false,           // passive flythrough
      fadeDuration: 80,             // less label flicker during zoom
      pitchWithRotate: false,
      dragRotate: false,
      maxZoom: 16,
      minZoom: 2,
    });

    map.on('error', e => console.warn('[whitespace-reel] map warn', e && e.error));

    map.on('load', () => {
      addLayers(map, practices, boundaries, verticals, colorById);
      hideLoadingVeil();
      const beats = buildBeats(verticals);
      window.__whitespaceReel = { map: map, bundle: bundle, beats: beats };
      if (REDUCED_MOTION) {
        applyBeat(map, cardSlot, beats[beats.length - 4], verticals, colorById, /*instant*/ true); // last "all-together at country"
        return;
      }
      runScheduler(map, cardSlot, beats, verticals, colorById);
    });
  }

  // ---------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------

  function addLayers(map, practices, boundaries, verticals, colorById) {
    // --- DMA boundaries: same hairline treatment the production
    //     Locations Map uses (#94a3b8 weight 0.5). Only visible at
    //     the country zoom; faded out by metro so streets read clean. ---
    map.addSource('dmas', { type: 'geojson', data: boundaries });
    map.addLayer({
      id: 'dma-borders',
      type: 'line',
      source: 'dmas',
      paint: {
        'line-color': '#94a3b8',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.4,
          5, 0.5,
          7, 0.5,
          9, 0.0,
        ],
        'line-opacity': [
          'interpolate', ['linear'], ['zoom'],
          2, 0.20,
          5, 0.32,
          7, 0.18,
          9, 0.0,
        ],
      },
    });

    // --- Practice dots — two stacked circle layers, mirroring the
    //     production deck.gl scatterplot architecture (glow + points).
    //     Both source the same data; paint expressions toggle which
    //     vertical is "loud" each beat. ---
    map.addSource('practices', { type: 'geojson', data: practices });

    // Sort-key: smaller categories render on TOP so Wellness (2K)
    // doesn't get buried under Cosmetic (20K) on the all-six beat.
    // Layout property — set once at layer creation; stays static
    // because on solo beats the inactive verticals are opacity:0
    // and stack order doesn't matter.
    const sortKeyExpr = sortKeyExpression(verticals);

    // GLOW layer: large, blurred, low alpha — the "city lights" halo.
    // Hidden for inactive verticals on solo beats so the active one pops.
    map.addLayer({
      id: 'practice-glow',
      type: 'circle',
      source: 'practices',
      layout: { 'circle-sort-key': sortKeyExpr },
      paint: {
        'circle-color':   colorExpression(verticals),
        'circle-radius':  glowRadiusExpression(),
        'circle-opacity': glowOpacityExpression(null, /*isAll*/ false),
        'circle-blur':    0.9,
      },
    });

    // POINTS layer: solid filled dots, no outline. The user is
    // explicit: "we dont use outline circles" — so no stroke. The
    // production map's stroke-at-zoom-6 trick reads as ghost-rings
    // here because our base is so dark; cleaner without.
    map.addLayer({
      id: 'practice-dots',
      type: 'circle',
      source: 'practices',
      layout: { 'circle-sort-key': sortKeyExpr },
      paint: {
        'circle-color':   colorExpression(verticals),
        'circle-radius':  radiusExpression(null, /*isAll*/ false),
        'circle-opacity': opacityExpression(null, /*isAll*/ false),
        'circle-stroke-width': 0,
        'circle-blur':    0.05,
      },
    });
  }

  // Sort key by category SIZE — smaller buckets float higher in the
  // stack. Counts come straight from the bundle so this stays in
  // sync with the data: re-derive → bigger Cosmetic number → still
  // sorts to the bottom. Highest sort-key renders on top.
  function sortKeyExpression(verticals) {
    const sized = verticals.slice().sort((a, b) => {
      const ca = (a.counts && a.counts.country) || 0;
      const cb = (b.counts && b.counts.country) || 0;
      return cb - ca;          // largest first → lowest sort key
    });
    const expr = ['match', ['get', 'v']];
    for (let i = 0; i < sized.length; i++) {
      expr.push(sized[i].id, i + 1);   // 1..N, larger = bigger sort key = on top
    }
    expr.push(0);                      // unknown verticals → bottom
    return expr;
  }

  function colorExpression(verticals, _activeId) {
    // Color is always the vertical's own color — what changes per beat
    // is opacity + radius (which vertical is "loud").
    const expr = ['match', ['get', 'v']];
    for (let i = 0; i < verticals.length; i++) {
      expr.push(verticals[i].id, verticals[i].color);
    }
    expr.push('#ffffff');
    return expr;
  }

  function opacityExpression(activeId, isAll) {
    // All-beat: every vertical visible together — high alpha so they
    // read against the dark basemap, but a touch under solo so the
    // overlap of all six doesn't blow out.
    if (isAll) return 0.92;
    // Open / fallback (no specific vertical highlighted): show
    // everything at half-strength so the canvas isn't empty.
    if (!activeId) return 0.55;
    // Solo beat: active vertical pops, inactive verticals VANISH.
    // No low-alpha ghost rings (user: "we dont use outline circles").
    return ['case',
      ['==', ['get', 'v'], activeId], 0.95,
      0.0,
    ];
  }

  function radiusExpression(activeId, isAll) {
    // Zoom-interpolated base. Bumped slightly across the board so
    // dots read as solid fills rather than pixel specks.
    const baseAtZoom = [
      'interpolate', ['linear'], ['zoom'],
      3, 1.8,
      6, 2.4,
      9, 3.2,
      12, 4.2,
      14, 5.4,
    ];
    if (isAll || !activeId) return baseAtZoom;
    return ['case',
      ['==', ['get', 'v'], activeId],
        ['interpolate', ['linear'], ['zoom'],
          3, 2.8,
          6, 3.8,
          9, 5.0,
          12, 6.4,
          14, 7.6,
        ],
      baseAtZoom,
    ];
  }

  // --- Glow layer expressions: bigger radius, lower alpha. Mirrors
  //     the production deck.gl "Glow" scatterplot tier (alpha 18-30,
  //     radiusMaxPixels 30, opacity 0.12). On solo beats only the
  //     active vertical's glow renders; on "all" beats every
  //     vertical glows softly. ---
  function glowRadiusExpression() {
    return [
      'interpolate', ['linear'], ['zoom'],
      3, 4,
      6, 6,
      9, 10,
      12, 16,
      14, 22,
    ];
  }

  function glowOpacityExpression(activeId, isAll) {
    if (isAll) return 0.22;
    if (!activeId) return 0.10;       // open / fallback — soft glow over all
    return ['case',
      ['==', ['get', 'v'], activeId], 0.40,
      0.0,
    ];
  }

  // ---------------------------------------------------------------
  // Cascade animation
  //
  // Each beat we want the dots to "stream in" instead of all
  // appearing at once. Per feature we shipped a randomized `seq`
  // (0..N-1). The cascade animates a moving threshold; features
  // with seq <= threshold pick up the target opacity, the rest stay
  // at 0. Ease-out cubic so the leading edge accelerates and the
  // trailing dots arrive in time without crawling.
  //
  // We rebuild the paint expression each rAF tick. setPaintProperty
  // recompiles the expression but the per-feature evaluation is
  // GPU-side, so the cost stays roughly constant in dot count.
  // ---------------------------------------------------------------

  function cancelCascade() {
    if (cascadeRAF !== null) {
      cancelAnimationFrame(cascadeRAF);
      cascadeRAF = null;
    }
  }

  function runCascade(map, dotsTarget, glowTarget, durationMs) {
    cancelCascade();
    if (!TOTAL_DOTS) {
      map.setPaintProperty('practice-dots', 'circle-opacity', dotsTarget);
      map.setPaintProperty('practice-glow', 'circle-opacity', glowTarget);
      return;
    }

    const start = performance.now();

    function gateExpr(target, threshold) {
      return ['case',
        ['<=', ['to-number', ['get', 'seq']], threshold],
        target,
        0,
      ];
    }

    function tick(now) {
      const t     = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const threshold = eased * TOTAL_DOTS;

      map.setPaintProperty('practice-dots', 'circle-opacity', gateExpr(dotsTarget, threshold));
      map.setPaintProperty('practice-glow', 'circle-opacity', gateExpr(glowTarget, threshold));

      if (t < 1) {
        cascadeRAF = requestAnimationFrame(tick);
      } else {
        // Drop the gate — settle to plain target expressions so the
        // hold portion of the beat doesn't keep recompiling paint.
        map.setPaintProperty('practice-dots', 'circle-opacity', dotsTarget);
        map.setPaintProperty('practice-glow', 'circle-opacity', glowTarget);
        cascadeRAF = null;
      }
    }
    cascadeRAF = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------
  // Beats
  // ---------------------------------------------------------------

  function buildBeats(verticals) {
    const beats = [];
    const ZOOMS = ['country', 'nyc', 'manhattan'];

    beats.push({ kind: 'open', zoom: 'country', durationMs: OPEN_MS });

    for (let zi = 0; zi < ZOOMS.length; zi++) {
      const zoom = ZOOMS[zi];
      for (let vi = 0; vi < verticals.length; vi++) {
        beats.push({
          kind: 'solo',
          zoom: zoom,
          vertical: verticals[vi],
          durationMs: SOLO_MS,
        });
      }
      beats.push({ kind: 'all', zoom: zoom, durationMs: ALL_MS });
    }
    return beats;
  }

  // ---------------------------------------------------------------
  // Scheduler — minimal rAF loop with visibilitychange pause/resume.
  // We don't reuse reel-engine.js because it's canvas-bound; this
  // ports the same patterns inline.
  // ---------------------------------------------------------------

  function runScheduler(map, cardSlot, beats, verticals, colorById) {
    const cycleMs = beats.reduce((s, b) => s + b.durationMs, 0);

    let cycleStart = performance.now();
    let pausedAt = 0;
    let pausedTotal = 0;
    let prevBeatIdx = -1;
    let prevZoom = null;

    function shiftTimeline(delta) { cycleStart += delta; }

    function onVisibility() {
      if (document.hidden) {
        if (!pausedAt) pausedAt = performance.now();
      } else if (pausedAt) {
        const dur = performance.now() - pausedAt;
        shiftTimeline(dur);
        pausedAt = 0;
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    function tick() {
      if (document.hidden) {
        requestAnimationFrame(tick);
        return;
      }
      if (pausedAt) {
        // came back from background — patch the timeline before reading t
        const dur = performance.now() - pausedAt;
        shiftTimeline(dur);
        pausedAt = 0;
      }

      const t = (performance.now() - cycleStart) % cycleMs;
      const located = locateBeat(beats, t);

      if (located.idx !== prevBeatIdx) {
        const beat = beats[located.idx];
        applyBeat(map, cardSlot, beat, verticals, colorById, /*instant*/ false, prevZoom);
        prevBeatIdx = located.idx;
        prevZoom = beat.zoom;
      }

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function locateBeat(beats, t) {
    let cum = 0;
    for (let i = 0; i < beats.length; i++) {
      const dur = beats[i].durationMs;
      if (t < cum + dur) return { idx: i, beatT: t - cum };
      cum += dur;
    }
    return { idx: beats.length - 1, beatT: 0 };
  }

  function applyBeat(map, cardSlot, beat, verticals, colorById, instant, prevZoom) {
    const isAll  = beat.kind === 'all';
    const isOpen = beat.kind === 'open';
    const activeId = beat.vertical ? beat.vertical.id : null;

    // Camera: only fly when the zoom level changes between beats.
    if (prevZoom !== beat.zoom || instant) {
      const cam = CAMERA[beat.zoom];
      if (instant || REDUCED_MOTION) {
        map.jumpTo({ center: cam.center, zoom: cam.zoom });
      } else {
        map.flyTo({
          center: cam.center,
          zoom: cam.zoom,
          duration: FLY_MS,
          essential: true,
          curve: 1.5,
        });
      }
    }

    // Dot styling — both layers update in lockstep so the glow
    // tracks whichever vertical is loud each beat. Radius is updated
    // instantly; opacity cascades in over CASCADE_MS using a
    // per-feature `seq` gate so dots stream on instead of flashing
    // on together.
    const dotsTarget = opacityExpression(activeId, isAll);
    const glowTarget = glowOpacityExpression(activeId, isAll);
    map.setPaintProperty('practice-dots', 'circle-radius',  radiusExpression(activeId, isAll));

    if (instant || REDUCED_MOTION) {
      cancelCascade();
      map.setPaintProperty('practice-dots', 'circle-opacity', dotsTarget);
      map.setPaintProperty('practice-glow', 'circle-opacity', glowTarget);
    } else {
      runCascade(map, dotsTarget, glowTarget, CASCADE_MS);
    }

    // Card crossfade.
    if (cardSlot) {
      if (isOpen) {
        fadeCard(cardSlot, '');
        return;
      }
      const html = formatCardFor(beat, verticals);
      fadeCard(cardSlot, html);
    }
  }

  // ---------------------------------------------------------------
  // Card crossfade
  // ---------------------------------------------------------------

  let cardFadeTimer = null;
  function fadeCard(slot, html) {
    if (REDUCED_MOTION) {
      slot.innerHTML = html;
      slot.style.opacity = html ? '1' : '0';
      return;
    }
    if (cardFadeTimer) clearTimeout(cardFadeTimer);
    slot.style.opacity = '0';
    cardFadeTimer = setTimeout(() => {
      slot.innerHTML = html;
      slot.style.opacity = html ? '1' : '0';
    }, 160);
  }

  // ---------------------------------------------------------------
  // Card formatter
  // ---------------------------------------------------------------

  function formatCardFor(beat, verticals) {
    if (!beat || beat.kind === 'open') return '';
    const zoomName = ZOOM_NAMES[beat.zoom] || beat.zoom;

    if (beat.kind === 'all') {
      let total = 0;
      for (let i = 0; i < verticals.length; i++) {
        total += (verticals[i].counts && verticals[i].counts[beat.zoom]) || 0;
      }
      return (
        '<div class="reel-card-eyebrow">All six verticals</div>' +
        '<div class="reel-card-number">' + formatNum(total) + '</div>' +
        '<div class="reel-card-meta">indexed practices in ' + escapeHtml(zoomName) + '</div>' +
        renderLegend(verticals, null)
      );
    }

    const v = beat.vertical;
    if (!v) return '';
    const count = (v.counts && v.counts[beat.zoom]) || 0;
    return (
      '<div class="reel-card-eyebrow" style="color:' + v.color + '">' + escapeHtml(v.label) + '</div>' +
      '<div class="reel-card-number">' + formatNum(count) + '</div>' +
      '<div class="reel-card-meta">indexed practices in ' + escapeHtml(zoomName) + '</div>' +
      renderLegend(verticals, v.id)
    );
  }

  const ZOOM_NAMES = {
    country:   'the U.S.',
    nyc:       'the New York metro',
    manhattan: 'Manhattan',
  };

  function renderLegend(verticals, activeId) {
    let html = '<div class="reel-card-legend">';
    for (let i = 0; i < verticals.length; i++) {
      const v = verticals[i];
      const active = v.id === activeId;
      const cls = 'reel-card-legend-item' + (active ? ' is-active' : '');
      html += '<span class="' + cls + '">' +
              '<i style="background:' + v.color + '"></i>' +
              escapeHtml(v.label) +
              '</span>';
    }
    html += '</div>';
    return html;
  }

  function formatNum(n) { return Number(n).toLocaleString(); }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => (
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' :
      c === '"' ? '&quot;' : '&#39;'
    ));
  }

  // ---------------------------------------------------------------
  // Loading veil
  // ---------------------------------------------------------------

  function hideLoadingVeil() {
    const veil = document.getElementById('whitespace-loading');
    if (!veil) return;
    veil.classList.add('is-hidden');
    setTimeout(() => veil.remove(), 400);
  }

  // ---------------------------------------------------------------

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
