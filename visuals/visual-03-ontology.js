/* ============================================================
   Visual 03 — Brand ontology force graph
   Root → 6 verticals → manufacturers → brands → products. ~734 nodes.
   Canvas + simple velocity-Verlet force simulation, no libs.
   Vertical color memory inherited down the chain.
   ============================================================ */

(function () {
  const VERTICAL_COLOR = {
    "Injectable":      "#e74c3c",
    "Laser":           "#9b59b6",
    "Body Contouring": "#f39c12",
    "Skin Treatment":  "#3498db",
    "Wellness":        "#2ecc71",
    "Cosmetic":        "#e67e22",
  };

  // ============================================================
  // SHARED graph primitives — hoisted to IIFE scope so both the
  // desktop init() (interactive force graph) and the mobile reel
  // (auto camera tour) can render the SAME ontology graph from the
  // SAME data. Desktop drives the chain highlight via mouse hover;
  // mobile drives it via the beat sequencer's spotlightNode.
  // ============================================================

  function colorWithAlpha(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16),
          g = parseInt(hex.slice(3, 5), 16),
          b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  }

  function buildParentMap(edges) {
    const m = new Map();
    for (const e of edges) m.set(e.b.id, e.a);
    return m;
  }

  function ancestorIdsOf(node, parentMap) {
    const ids = new Set();
    let cur = node;
    while (cur) { ids.add(cur.id); cur = parentMap.get(cur.id) || null; }
    return ids;
  }

  function ancestorEdgeKeysOf(node, parentMap) {
    const set = new Set();
    let cur = node;
    while (parentMap.has(cur.id)) {
      const p = parentMap.get(cur.id);
      set.add(p.id + '->' + cur.id);
      cur = p;
    }
    return set;
  }

  function ancestorChainOf(node, parentMap) {
    const chain = [];
    let cur = node;
    while (cur) { chain.push(cur); cur = parentMap.get(cur.id) || null; }
    return chain.reverse();
  }

  // Builds the ontology graph. Returns { nodes, edges }. opts.skipProducts
  // drops depth-4 product nodes for tighter layouts on small canvases
  // (the desktop sets this to true on phones in its existing usage; the
  // mobile reel sets it to false because products are the spotlight leaf).
  function buildOntologyGraph(tree, W, H, opts) {
    const nodes = [], edges = [];
    const cx = W / 2, cy = H / 2;
    const skipProducts = !!(opts && opts.skipProducts);
    const root = { id: 'root', label: 'Aesthetics Index', type: 'root', color: '#5a6180',
                   x: cx, y: cy, vx: 0, vy: 0, r: 7, fixed: true, depth: 0, vertical: null,
                   childCount: tree.children.length };
    nodes.push(root);

    tree.children.forEach((vert, i) => {
      const angle = (i / tree.children.length) * Math.PI * 2 - Math.PI / 2;
      const dist = Math.min(W, H) * 0.18;
      const vNode = {
        id: vert.id || vert.label,
        label: vert.label, type: 'vertical',
        color: VERTICAL_COLOR[vert.label] || '#8892b0',
        x: cx + Math.cos(angle) * dist + (Math.random() - 0.5) * 8,
        y: cy + Math.sin(angle) * dist + (Math.random() - 0.5) * 8,
        vx: 0, vy: 0,
        r: 9 + Math.sqrt(vert.child_count || 1) * 0.6,
        depth: 1, vertical: vert.label,
        childCount: (vert.children || []).length,
      };
      nodes.push(vNode);
      edges.push({ a: root, b: vNode, w: 0.4 });

      (vert.children || []).forEach(mfg => {
        // Unattributed bucket: orphan brands attach directly to vertical.
        const isUnattributedBucket =
          mfg.label === 'Independent / Unattributed' ||
          /unattributed/i.test(mfg.label || '');

        let parentNode, ma, md;
        if (isUnattributedBucket) {
          parentNode = vNode;
          ma = angle;
          md = Math.min(W, H) * 0.18;
        } else {
          ma = angle + (Math.random() - 0.5) * 0.9;
          md = dist + 90 + Math.random() * 30;
          const mNode = {
            id: mfg.id || (vert.label + '/' + mfg.label),
            label: mfg.label, type: 'manufacturer',
            color: vNode.color,
            x: cx + Math.cos(ma) * md, y: cy + Math.sin(ma) * md,
            vx: 0, vy: 0,
            r: 4 + Math.sqrt(mfg.child_count || 1) * 0.5,
            depth: 2, vertical: vert.label,
            childCount: (mfg.children || []).length,
            parentLabel: vert.label,
          };
          nodes.push(mNode);
          edges.push({ a: vNode, b: mNode, w: 0.18 });
          parentNode = mNode;
        }

        (mfg.children || []).forEach(brand => {
          const ba = isUnattributedBucket
            ? angle + (Math.random() - 0.5) * 1.6
            : ma + (Math.random() - 0.5) * 0.7;
          const bd = md + 50 + Math.random() * 20;
          const bNode = {
            id: brand.id || (mfg.label + '/' + brand.label),
            label: brand.label, type: 'brand',
            color: vNode.color,
            x: cx + Math.cos(ba) * bd, y: cy + Math.sin(ba) * bd,
            vx: 0, vy: 0,
            r: 2.6 + Math.sqrt(brand.child_count || 1) * 0.4,
            depth: 3, vertical: vert.label,
            childCount: (brand.children || []).length,
            parentLabel: isUnattributedBucket ? vert.label : mfg.label,
          };
          nodes.push(bNode);
          edges.push({ a: parentNode, b: bNode, w: 0.12 });

          if (!skipProducts) {
            (brand.children || []).forEach(prod => {
              const pa = ba + (Math.random() - 0.5) * 0.6;
              const pd = bd + 28 + Math.random() * 12;
              const pNode = {
                id: prod.id || (brand.label + '/' + prod.label),
                label: prod.label, type: 'product',
                color: vNode.color,
                x: cx + Math.cos(pa) * pd, y: cy + Math.sin(pa) * pd,
                vx: 0, vy: 0,
                r: 1.5,
                depth: 4, vertical: vert.label,
                childCount: 0,
                parentLabel: brand.label,
              };
              nodes.push(pNode);
              edges.push({ a: bNode, b: pNode, w: 0.10 });
            });
          }
        });
      });
    });

    return { nodes, edges };
  }

  // Force-sim constants — same numbers the desktop has tuned over time.
  const ONTO_REPULSE = 80;
  const ONTO_LINK_DIST = { 1: 120, 2: 60, 3: 36, 4: 22 };
  const ONTO_ALPHA_MIN = 0.02;
  const ONTO_ALPHA_DECAY = 0.018;

  // One velocity-Verlet integration step. Mutates nodes' vx/vy/x/y.
  // alphaState is a single-key object so the caller can read/write
  // it across calls without us returning a tuple.
  function stepOntologyForce(nodes, edges, W, H, alphaState) {
    const cx = W / 2, cy = H / 2;
    const a = alphaState.alpha;

    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx += (cx - n.x) * 0.0008 * a;
      n.vy += (cy - n.y) * 0.0008 * a;
    }

    for (let i = 0; i < nodes.length; i++) {
      const A = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const B = nodes[j];
        let dx = B.x - A.x;
        let dy = B.y - A.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 6400) continue;
        if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        const f = ONTO_REPULSE / d2 * a;
        dx /= d; dy /= d;
        if (!A.fixed) { A.vx -= dx * f; A.vy -= dy * f; }
        if (!B.fixed) { B.vx += dx * f; B.vy += dy * f; }
      }
    }

    for (const e of edges) {
      const A = e.a, B = e.b;
      const dx = B.x - A.x, dy = B.y - A.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = ONTO_LINK_DIST[B.depth] || 30;
      const f = (d - target) * 0.05 * a;
      const nx = dx / d, ny = dy / d;
      if (!A.fixed) { A.vx += nx * f; A.vy += ny * f; }
      if (!B.fixed) { B.vx -= nx * f; B.vy -= ny * f; }
    }

    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx *= 0.78;
      n.vy *= 0.78;
      n.x += n.vx;
      n.y += n.vy;
      const m = 8;
      if (n.x < m) { n.x = m; n.vx *= -0.5; }
      if (n.y < m) { n.y = m; n.vy *= -0.5; }
      if (n.x > W - m) { n.x = W - m; n.vx *= -0.5; }
      if (n.y > H - m) { n.y = H - m; n.vy *= -0.5; }
    }

    alphaState.alpha = Math.max(ONTO_ALPHA_MIN, a - ONTO_ALPHA_DECAY);
  }

  // Renders the ontology graph: edges, nodes, labels. The chainNode opt
  // (any node ref or null) drives the chain-highlight: that node and
  // every ancestor get full opacity + outline ring; everything else is
  // dimmed. Desktop passes hoveredNode; mobile passes spotlightNode.
  // labelChain (mobile-only): when true, every node in the ancestor
  // chain gets its own labeled name — not just the leaf — so the
  // viewer sees vertical -> mfr -> brand -> product all at once.
  // activeVertical (desktop-only): a separate dimming filter for the
  // legend chips (e.g., click "Injectable" to fade everything else).
  //
  // chainProgress (mobile-reel-only, optional): integer N. When
  // provided, only the first N non-root ancestors of chainNode count
  // as "lit" — the others render as if not on the chain. Lets the
  // mobile timeline animate ancestors lighting up sequentially. When
  // omitted (desktop default), the full chain lights up exactly as
  // before. chainProgress=0 disables the chain highlight entirely
  // even though chainNode is set (used during the segment-entry pan).
  // edgeDrawProgress (mobile-reel-only, optional): Map<edgeKey, 0..1>.
  // Chain edges with a matching key are drawn from a→b only up to
  // that fraction. Non-chain edges and chain edges without an entry
  // render at full length. Used to animate the link "drawing in" on
  // each activation tick. When omitted, all edges draw fully.
  function drawOntologyGraph(ctx, nodes, edges, parentMap, cam, DPR, W, H, opts) {
    const chainNode = (opts && opts.chainNode) || null;
    const activeVertical = (opts && opts.activeVertical) || null;
    const labelChain = !!(opts && opts.labelChain);
    const chainProgressOpt = (opts && typeof opts.chainProgress === 'number')
      ? opts.chainProgress : null;
    const edgeDrawProgress = (opts && opts.edgeDrawProgress) || null;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.z, cam.z);

    // Resolve which slice of the ancestor chain is currently lit.
    // chainProgressOpt === null (desktop) → full chain (legacy behavior).
    // chainProgressOpt > 0 → root + that many non-root ancestors.
    // chainProgressOpt === 0 → no chain at all (camera-pan window).
    let activeChain = null;
    if (chainNode) {
      const fullChain = ancestorChainOf(chainNode, parentMap);
      if (chainProgressOpt === null) {
        activeChain = fullChain;
      } else if (chainProgressOpt > 0) {
        activeChain = fullChain.slice(0, Math.min(fullChain.length, chainProgressOpt + 1));
      }
    }
    let chainIds = null, chainEdges = null;
    if (activeChain) {
      chainIds = new Set();
      chainEdges = new Set();
      for (let i = 0; i < activeChain.length; i++) {
        chainIds.add(activeChain[i].id);
        if (i > 0) chainEdges.add(activeChain[i - 1].id + '->' + activeChain[i].id);
      }
    }
    const hasChain = chainIds !== null;

    // Edges
    for (const e of edges) {
      const a = e.a, b = e.b;
      const v = b.vertical || a.vertical;
      const edgeKey = a.id + '->' + b.id;
      const isOnChain = chainEdges && chainEdges.has(edgeKey);
      const dimByVertical = activeVertical && v && v !== activeVertical;
      const dimByChain = hasChain && !isOnChain &&
        !chainIds.has(a.id) && !chainIds.has(b.id);
      let op;
      if (isOnChain) op = 0.95;
      else if (dimByVertical || dimByChain) op = 0.04;
      else op = e.w * 1.8;
      ctx.strokeStyle = colorWithAlpha(b.color, op);
      ctx.lineWidth = isOnChain ? 1.4 / cam.z : 0.5 / cam.z;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (isOnChain && edgeDrawProgress && edgeDrawProgress.has(edgeKey)) {
        const p = Math.max(0, Math.min(1, edgeDrawProgress.get(edgeKey)));
        ctx.lineTo(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p);
      } else {
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }

    // Nodes
    for (const n of nodes) {
      const dimByVertical = activeVertical && n.vertical && n.vertical !== activeVertical && n.type !== 'root';
      const dimByChain = hasChain && !chainIds.has(n.id);
      const onChain = chainIds && chainIds.has(n.id);
      let op;
      if (onChain) op = 1.0;
      else if (dimByVertical || dimByChain) op = 0.10;
      else op = (n.type === 'product' ? 0.55 : (n.type === 'brand' ? 0.75 : 0.95));
      ctx.beginPath();
      ctx.fillStyle = colorWithAlpha(n.color, op);
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (onChain && n.type !== 'root') {
        ctx.strokeStyle = colorWithAlpha(n.color, 0.7);
        ctx.lineWidth = 2 / cam.z;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 / cam.z, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const n of nodes) {
      if (n.type === 'vertical') {
        // Mobile chain mode: when a chain is currently lit
        // (labelChain && hasChain), suppress every vertical label
        // that isn't the chain's own vertical. Otherwise sibling
        // verticals like "Laser" leak into a Botox/Injectable shot
        // just because their nodes happened to land in the camera
        // frame, and that reads as a contradiction. With chainNode
        // set but chainProgress=0 (mid-pan), hasChain is false, so
        // all verticals stay labeled — same as the wide pose.
        const onChain = chainIds && chainIds.has(n.id);
        if (labelChain && hasChain && !onChain) continue;
        const dim = activeVertical && n.label !== activeVertical;
        ctx.fillStyle = onChain ? '#ffffff' : (dim ? 'rgba(228,232,244,0.25)' : '#e4e8f4');
        const fz = (12 / cam.z).toFixed(2);
        ctx.font = '800 ' + fz + 'px Inter, system-ui, sans-serif';
        ctx.fillText(n.label, n.x, n.y - n.r - 8 / cam.z);
      }
    }

    if (hasChain) {
      // Mobile: label every lit chain ancestor (so the parent labels
      // persist as the chain grows). Desktop: label only the leaf
      // (matches the existing hover-label behavior).
      if (labelChain) {
        for (const n of activeChain) {
          if (n.type === 'vertical' || n.type === 'root') continue;
          const fz = (11 / cam.z).toFixed(2);
          ctx.font = '700 ' + fz + 'px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#e4e8f4';
          ctx.strokeStyle = 'rgba(8,9,13,0.85)';
          ctx.lineWidth = 3 / cam.z;
          const lab = n.label;
          ctx.strokeText(lab, n.x, n.y - n.r - 8 / cam.z);
          ctx.fillText(lab, n.x, n.y - n.r - 8 / cam.z);
        }
      } else if (chainNode && chainNode.type !== 'vertical' && chainNode.type !== 'root') {
        const fz = (11 / cam.z).toFixed(2);
        ctx.font = '700 ' + fz + 'px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e4e8f4';
        ctx.strokeStyle = 'rgba(8,9,13,0.85)';
        ctx.lineWidth = 3 / cam.z;
        const lab = chainNode.label;
        ctx.strokeText(lab, chainNode.x, chainNode.y - chainNode.r - 8 / cam.z);
        ctx.fillText(lab, chainNode.x, chainNode.y - chainNode.r - 8 / cam.z);
      }
    }

    // Restore the screen-space DPR transform so callers can keep
    // drawing overlays (particles, labels) in canvas pixels without
    // having to undo the camera projection themselves.
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function init() {
    const canvas = document.getElementById('ontology-canvas');
    if (!canvas) return;

    // Mobile (<768 CSS px) gets a cinematic auto-camera tour of the
    // SAME force graph the desktop renders. The reel boots by loading
    // the full data/ontology.json, pre-baking the force simulation,
    // and then driving a beat sequencer that lerps the camera through
    // a hand-picked spotlight chain (Botox, AviClear, …) one vertical
    // per loop. All rendering goes through the shared drawOntologyGraph
    // so links, labels, and the chain-highlight pattern are identical
    // to desktop — every node label is canvas-painted, so DOM exposure
    // matches desktop's (canvas pixels only, no proper nouns leak).
    // The "Big Bang" particle opener is preserved as a cold-open that
    // settles INTO the force-positioned graph.
    if (window.innerWidth < 768) {
      runReel(canvas);
      return;
    }

    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const labelEl = document.getElementById('ontology-label');
    const filterEl = document.getElementById('ontology-filter');
    const statsEl = document.getElementById('ontology-stats');

    let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
    let nodes = [], edges = [];
    let activeVertical = null;
    let hoveredNode = null;
    let raf = null;

    // Camera. cam.* is the current state, cam.t* is the lerp target.
    // Wheel and drag set both at once (no animation). Filter-chip click
    // and dblclick set only the targets so the loop animates toward them.
    const cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 };
    const ZOOM_MIN = 0.4, ZOOM_MAX = 6;
    let dragState = null;
    let dirty = true;
    let parentMap = new Map();

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    // Thin wrappers — delegate to the hoisted helpers so the chain-
    // highlight logic is shared between desktop and the mobile reel.
    function ancestorIds(node)      { return ancestorIdsOf(node, parentMap); }
    function ancestorEdgeKeys(node) { return ancestorEdgeKeysOf(node, parentMap); }
    function ancestorChain(node)    { return ancestorChainOf(node, parentMap); }
    function focusVertical(vertLabel) {
      const v = nodes.find(n => n.type === 'vertical' && n.label === vertLabel);
      if (!v) return;
      const z = 2.0;
      cam.tz = z;
      cam.tx = W / 2 - v.x * z;
      cam.ty = H / 2 - v.y * z;
      dirty = true;
    }
    function resetCamera() {
      cam.tx = 0; cam.ty = 0; cam.tz = 1;
      dirty = true;
    }
    function zoomAtPoint(mx, my, factor) {
      const newZ = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
      const wx = (mx - cam.x) / cam.z;
      const wy = (my - cam.y) / cam.z;
      cam.x = mx - wx * newZ;
      cam.y = my - wy * newZ;
      cam.z = newZ;
      cam.tx = cam.x; cam.ty = cam.y; cam.tz = cam.z;
      dirty = true;
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // Thin wrappers around the hoisted ontology helpers. Init keeps
    // its own nodes/edges/parentMap state; the wrappers just delegate.
    // Phones still skip product nodes for the desktop force-graph
    // build (the layout reads better at <768 CSS px without them);
    // mobile reel uses its own runReel() path with skipProducts=false.
    function buildGraph(tree) {
      const r = buildOntologyGraph(tree, W, H, { skipProducts: window.innerWidth < 768 });
      nodes = r.nodes;
      edges = r.edges;
      parentMap = buildParentMap(edges);
    }

    const alphaState = { alpha: 1 };
    function step() { stepOntologyForce(nodes, edges, W, H, alphaState); }

    function draw() {
      drawOntologyGraph(ctx, nodes, edges, parentMap, cam, DPR, W, H, {
        chainNode: hoveredNode,
        activeVertical,
      });
    }

    let lastFrame = 0, simTime = 0, settled = false;
    const SIM_BUDGET_MS = reduced ? 2400 : 4200; // run sim briefly then freeze

    function loop(now) {
      if (!lastFrame) lastFrame = now;
      const dt = now - lastFrame;
      lastFrame = now;

      if (!settled) {
        simTime += dt;
        for (let k = 0; k < 2; k++) step();
        if (simTime > SIM_BUDGET_MS || alphaState.alpha <= ONTO_ALPHA_MIN + 0.001) settled = true;
        dirty = true;
      }

      // Camera lerp toward target. Reduced-motion users get an instant
      // snap rather than a 200ms ease.
      const lerp = reduced ? 1.0 : 0.18;
      const dx = cam.tx - cam.x, dy = cam.ty - cam.y, dz = cam.tz - cam.z;
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1 || Math.abs(dz) > 0.001) {
        cam.x += dx * lerp;
        cam.y += dy * lerp;
        cam.z += dz * lerp;
        dirty = true;
      }

      if (dirty) {
        draw();
        dirty = false;
      }
      raf = requestAnimationFrame(loop);
    }

    function pickNode(mx, my, zoom) {
      zoom = zoom || 1;
      // Tolerance is in WORLD units. Divide by zoom so the effective
      // screen-space tolerance stays ~16px whether we're zoomed in or out.
      const tol = 16 / zoom;
      const tol2 = tol * tol;
      const slop = 6 / zoom;
      let best = null, bestD2 = tol2;
      for (const n of nodes) {
        const dx = n.x - mx, dy = n.y - my;
        const d2 = dx * dx + dy * dy;
        const rSlop = n.r + slop;
        const r2 = Math.max(tol2 * 0.25, rSlop * rSlop);
        if (d2 < r2 && d2 < bestD2) { best = n; bestD2 = d2; }
      }
      return best;
    }

    function updateInfoPanel() {
      if (!labelEl) return;
      if (!hoveredNode || hoveredNode.type === 'root') {
        labelEl.innerHTML = '';
        labelEl.style.borderColor = '';
        return;
      }
      const chain = ancestorChain(hoveredNode)
        .filter(n => n.type !== 'root' && n.id !== hoveredNode.id)
        .map(n => n.label);
      const trail = chain.join('  ›  ');
      const cc = hoveredNode.childCount || 0;
      const childLabel = hoveredNode.type === 'vertical' ? 'manufacturer'
        : hoveredNode.type === 'manufacturer' ? 'brand'
        : hoveredNode.type === 'brand' ? 'product' : '';
      const cs = cc > 0 && childLabel
        ? cc + ' ' + childLabel + (cc === 1 ? '' : 's')
        : '';
      labelEl.innerHTML =
        '<div class="onto-info-name" style="color:' + hoveredNode.color + '">' +
          escapeHtml(hoveredNode.label) +
        '</div>' +
        '<div class="onto-info-meta">' +
          '<span class="onto-info-type">' + escapeHtml(hoveredNode.type) + '</span>' +
          (cs ? ' &middot; <span class="onto-info-count">' + escapeHtml(cs) + '</span>' : '') +
        '</div>' +
        (trail ? '<div class="onto-info-trail">' + escapeHtml(trail) + '</div>' : '');
    }

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      // Hover-pick is suppressed while the user is dragging the canvas.
      if (dragState) return;
      const wx = (mx - cam.x) / cam.z;
      const wy = (my - cam.y) / cam.z;
      const prev = hoveredNode;
      // pickNode tolerance grows when zoomed out so small product nodes
      // remain pickable. Pass cam.z so pickNode can scale its radius.
      hoveredNode = pickNode(wx, wy, cam.z);
      if (prev !== hoveredNode) {
        updateInfoPanel();
        canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
        dirty = true;
      }
    });
    canvas.addEventListener('mouseleave', () => {
      if (hoveredNode !== null) {
        hoveredNode = null;
        updateInfoPanel();
        dirty = true;
      }
    });

    // Drag-to-pan. Captured on window so a fast drag that exits the
    // canvas mid-motion doesn't leave the camera mid-translation.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragState = {
        startMx: e.clientX, startMy: e.clientY,
        startCamX: cam.x, startCamY: cam.y,
        moved: false,
      };
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startMx;
      const dy = e.clientY - dragState.startMy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true;
      cam.x = dragState.startCamX + dx;
      cam.y = dragState.startCamY + dy;
      cam.tx = cam.x; cam.ty = cam.y;
      dirty = true;
    });
    window.addEventListener('mouseup', () => {
      if (!dragState) return;
      canvas.style.cursor = 'grab';
      dragState = null;
    });

    // Touch: one-finger drag-pan, two-finger pinch-zoom anchored at the
    // midpoint of the two fingers. The dblclick reset still works on
    // touch (mobile browsers synthesize dblclick from a fast double-tap).
    // touch-action: none on the canvas blocks the browser from
    // intercepting these gestures for page scroll / native pinch-zoom.
    canvas.style.touchAction = 'none';
    let pinchState = null;
    function touchPos(t) {
      const rect = canvas.getBoundingClientRect();
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        dragState = {
          startMx: t.clientX, startMy: t.clientY,
          startCamX: cam.x, startCamY: cam.y,
          moved: false,
        };
        pinchState = null;
      } else if (e.touches.length === 2) {
        dragState = null;
        const a = touchPos(e.touches[0]);
        const b = touchPos(e.touches[1]);
        pinchState = {
          startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          startCamX: cam.x, startCamY: cam.y, startCamZ: cam.z,
        };
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && dragState) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - dragState.startMx;
        const dy = t.clientY - dragState.startMy;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true;
        cam.x = dragState.startCamX + dx;
        cam.y = dragState.startCamY + dy;
        cam.tx = cam.x; cam.ty = cam.y;
        dirty = true;
      } else if (e.touches.length === 2 && pinchState) {
        e.preventDefault();
        const a = touchPos(e.touches[0]);
        const b = touchPos(e.touches[1]);
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const factor = dist / pinchState.startDist;
        const newZ = clamp(pinchState.startCamZ * factor, ZOOM_MIN, ZOOM_MAX);
        // Anchor zoom at the midpoint captured at touchstart so the
        // gesture feels stable (matches wheel-zoom-at-cursor semantics).
        const wx = (pinchState.midX - pinchState.startCamX) / pinchState.startCamZ;
        const wy = (pinchState.midY - pinchState.startCamY) / pinchState.startCamZ;
        cam.x = pinchState.midX - wx * newZ;
        cam.y = pinchState.midY - wy * newZ;
        cam.z = newZ;
        cam.tx = cam.x; cam.ty = cam.y; cam.tz = cam.z;
        dirty = true;
      }
    }, { passive: false });
    function endTouch(e) {
      if (e.touches.length === 0) {
        dragState = null;
        pinchState = null;
      } else if (e.touches.length === 1) {
        // Lifted one of two fingers; resume single-finger pan from
        // the remaining finger's position (no jump).
        pinchState = null;
        const t = e.touches[0];
        dragState = {
          startMx: t.clientX, startMy: t.clientY,
          startCamX: cam.x, startCamY: cam.y,
          moved: false,
        };
      }
    }
    canvas.addEventListener('touchend', endTouch, { passive: true });
    canvas.addEventListener('touchcancel', endTouch, { passive: true });

    // Wheel-zoom anchored at cursor. preventDefault so the page doesn't
    // scroll while the user is zooming the graph.
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAtPoint(mx, my, factor);
    }, { passive: false });

    // Double-click to reset.
    canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      resetCamera();
    });

    if (filterEl) {
      filterEl.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-vert]');
        if (!chip) return;
        const v = chip.dataset.vert;
        if (activeVertical === v) {
          activeVertical = null;
          filterEl.querySelectorAll('[data-vert]').forEach(c => c.classList.remove('active'));
          resetCamera();
        } else {
          activeVertical = v;
          filterEl.querySelectorAll('[data-vert]').forEach(c =>
            c.classList.toggle('active', c.dataset.vert === v));
          focusVertical(v);
        }
        dirty = true;
      });
    }

    // Floating zoom controls (+ / − / reset) — generated in JS so the
    // figure HTML stays clean. Mounted into the same .viz-frame parent
    // as the canvas so they overlay correctly.
    const frame = canvas.parentNode;
    if (frame) {
      const ctrlEl = document.createElement('div');
      ctrlEl.className = 'viz-overlay viz-overlay-br viz-zoom-controls';
      ctrlEl.innerHTML =
        '<button type="button" data-action="zoom-in" aria-label="Zoom in">+</button>' +
        '<button type="button" data-action="zoom-out" aria-label="Zoom out">\u2212</button>' +
        '<button type="button" data-action="reset" aria-label="Reset view">\u27F2</button>';
      frame.appendChild(ctrlEl);
      ctrlEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'reset') { resetCamera(); return; }
        // Zoom toward the visible center.
        const factor = action === 'zoom-in' ? 1.35 : 1 / 1.35;
        const newZ = clamp(cam.z * factor, ZOOM_MIN, ZOOM_MAX);
        const wx = (W / 2 - cam.x) / cam.z;
        const wy = (H / 2 - cam.y) / cam.z;
        cam.tx = W / 2 - wx * newZ;
        cam.ty = H / 2 - wy * newZ;
        cam.tz = newZ;
        dirty = true;
      });

      // Discoverability hint, fades after 5s. Wording adapts to the
      // input available: pinch/swipe on touch devices, scroll/drag
      // otherwise. matchMedia('(pointer: coarse)') is the standard
      // touch-primary signal.
      const hintEl = document.createElement('div');
      hintEl.className = 'viz-onto-hint';
      const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      hintEl.textContent = isTouch
        ? 'pinch to zoom \u00b7 drag to pan \u00b7 double-tap to reset'
        : 'scroll to zoom \u00b7 drag to pan \u00b7 double-click to reset';
      frame.appendChild(hintEl);
      setTimeout(() => hintEl.classList.add('fade-out'), 5000);
      const dismissHint = () => hintEl.classList.add('fade-out');
      canvas.addEventListener('mousedown', dismissHint, { once: true });
      canvas.addEventListener('wheel', dismissHint, { once: true });
      canvas.addEventListener('touchstart', dismissHint, { once: true, passive: true });
    }

    fetch('data/ontology.json').then(r => r.json()).then(tree => {
      resize();
      buildGraph(tree);

      if (statsEl) {
        const counts = { manufacturer: 0, brand: 0, product: 0 };
        for (const n of nodes) if (counts[n.type] !== undefined) counts[n.type]++;
        statsEl.textContent = '6 verticals · ' + counts.manufacturer + ' manufacturers · ' +
                              counts.brand + ' brands · ' + counts.product + ' products';
      }
      // Always run the loop — even reduced-motion users need it for
      // pan/zoom/hover repaints. `settled` gates the expensive sim work.
      if (reduced) {
        for (let k = 0; k < 220; k++) step();
        settled = true;
      }
      raf = requestAnimationFrame(loop);
    }).catch(err => console.warn('ontology load failed', err));

    let rt = null;
    window.addEventListener('resize', () => {
      if (rt) cancelAnimationFrame(rt);
      rt = requestAnimationFrame(() => { resize(); draw(); });
    });
  }

  // ============================================================
  // Mobile reel — single continuous timeline of the SAME force
  // graph the desktop renders, walked through one chain per
  // vertical. No beats, no scene cuts, no opener particles, no
  // tagline reveals. One camera, six chains, seamless loop.
  //
  // Composition timeline (~54s):
  //   0-3s     wide hold (whole world visible)
  //   3-11s    Injectable chain  (Juvederm › Vollure XC)
  //   11-19s   Laser chain       (Sciton › Halo › TRIBRID)
  //   19-27s   Body Contouring   (Cutera › truSculpt › fleX)
  //   27-35s   Skin Treatment    (Alma › Opus › Plasma)
  //   35-43s   Wellness          (Ozempic › Semaglutide)
  //   43-51s   Cosmetic          (Natrelle › Inspira)
  //   51-54s   tail back to wide → seamless wrap
  //
  // Chains are picked so brand and product labels are visibly
  // distinct (e.g. "Halo › Halo TRIBRID", not "Halo › Halo") so
  // each activation reads as a real progression to a specific
  // product and not a redundant repeat of the brand name.
  //
  // Per 8s chain segment:
  //   0.0-1.5s   camera lerps toward vertical's node-frame
  //   1.5s       vertical activates (chainProgress 0→1, pulse, card)
  //   3.0s       manufacturer activates  (camera pans to mfr)
  //   4.5s       brand activates         (camera pans to brand)
  //   6.0s       product activates       (camera pans to product)
  //   6.0-8.0s   hold on product node-frame with ken-burns drift
  //
  // Camera tracking: instead of locking on a static "fits the whole
  // chain" frame, the camera SMOOTH-LERPS to center on the most
  // recently activated node. This (a) keeps the active node's label
  // in the upper-middle of the canvas (label clearance guaranteed)
  // and (b) gives each activation a visible cinematic "arrival".
  //
  // Phase 1 layout note: the graph is built at virtual desktop dims
  // (1024 x 900) and the mobile canvas is just a viewport into that
  // world. Building against the tiny mobile canvas would compress
  // ~734 nodes into a Pollock blob — unreadable. The wide camera
  // pose fits the world to the canvas; chain camera poses zoom in
  // on each chain's bbox.
  //
  // IP posture: drawOntologyGraph paints labels to canvas pixels
  // (no DOM exposure of proper nouns). The mobile-only info card
  // ALSO mirrors the active node into #ontology-label as the user
  // explicitly requested — flagged here as a documented decision.
  //
  // Function is hoisted within this IIFE so init()'s early-return
  // call above resolves even though the body lives down here.
  // ============================================================
  function runReel(canvas) {
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cardEl = document.getElementById('ontology-label');

    // DPR-capped at 1.5 on mobile per the existing perf rule.
    let DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0;

    // Virtual world: graph is built and sim is run against these
    // dimensions, NOT the mobile canvas size. The camera projects
    // world coords into screen coords via cam.z and cam.x/cam.y.
    const WORLD_W = 1024, WORLD_H = 900;

    // Camera state — world coords project to screen as
    // (n.x * cam.z + cam.x, n.y * cam.z + cam.y). Same as desktop.
    const cam = { x: 0, y: 0, z: 1 };

    // Graph state — populated at boot.
    let nodes = [], edges = [], parentMap = null;

    // Six chains, one per vertical. Each tuple is the *named* node
    // we want as the spotlight leaf; the manufacturer is auto-derived
    // by walking parentMap up from the resolved product. If a named
    // product is missing, we fall back to rank-0 product in the
    // vertical so the reel never has a black gap.
    //
    // Picked so the brand label and product label are visibly
    // different in every chain — e.g. "Halo" → "Halo TRIBRID", not
    // "Halo" → "Halo" — so each activation reveals new information
    // instead of repeating the brand name twice.
    const CHAIN_DEFS = [
      { vertical: 'Injectable',      brand: 'Juvederm',   product: 'Juvederm Vollure XC' },
      { vertical: 'Laser',           brand: 'Halo',       product: 'Halo TRIBRID' },
      { vertical: 'Body Contouring', brand: 'truSculpt',  product: 'truSculpt fleX' },
      { vertical: 'Skin Treatment',  brand: 'Opus',       product: 'Opus Plasma' },
      { vertical: 'Wellness',        brand: 'Ozempic',    product: 'Ozempic (Semaglutide)' },
      { vertical: 'Cosmetic',        brand: 'Natrelle',   product: 'Natrelle Inspira Silicone Implants' },
    ];
    let chains = [];                              // resolved at boot
    let wideFrame = { x: 0, y: 0, z: 1 };         // wide camera pose

    // Timeline constants — see top-of-function ascii for the schedule.
    // Activations spaced 1.5s apart give the viewer ~1s of dwell on
    // each label after the camera arrives (the camera lerp filter
    // settles in ~0.7s) — long enough to read, short enough to stay
    // cinematic.
    const WIDE_HOLD_S      = 3;
    const SEG_DUR_S        = 8;
    const TAIL_DUR_S       = 3;
    const ACTIVATIONS_S    = [1.5, 3.0, 4.5, 6.0]; // V, M, B, P
    const EDGE_ANIM_DUR_MS = 600;
    const PULSE_LIFE_MS    = 700;
    // Smooth low-pass filter for camera tracking. 0.08 per 60fps
    // frame settles to ~95% in ~1s, ~99% in ~1.5s — fast enough to
    // arrive between activations, slow enough to feel deliberate.
    const CAM_LERP_RATE    = 0.08;
    let CYCLE_DURATION_S   = WIDE_HOLD_S + CHAIN_DEFS.length * SEG_DUR_S + TAIL_DUR_S; // 54s

    // Timeline state — re-zeroed on every loop wrap.
    let cycleStartMs       = 0;
    let currentSegIdx      = -2;                  // sentinel so first transition fires
    let currentChainProg   = 0;                   // 0=none, 1=V, 2=M, 3=B, 4=P
    let prevPose           = null;                // camera at phase start (tail lerp source)
    let edgeAnims          = new Map();           // edgeKey -> { startMs, durMs }
    let pulses             = [];                  // { node, born, lifeMs }
    let activeNode         = null;                // most recently lit node (drives card)

    // Card crossfade state (mobile-only DOM mirror of the active node).
    let lastCardId         = null;
    let cardFadeTimeout    = null;

    // Soft fade-in from black on first start. After loop wrap we keep
    // fadeAlpha at 1 (no re-fade, otherwise the loop would visibly
    // pulse). FADE_IN_MS only applies to the first cold start.
    const FADE_IN_MS = 900;
    let fadeStartedAt = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // ===================================================================
    // Camera frames
    // ===================================================================

    // Wide pose: fit the entire WORLD into the mobile canvas with a
    // small margin. The 0.92 factor is the breathing band around the
    // perimeter so vertical labels never kiss the bezel.
    function computeWideFrame() {
      const z = Math.min(W / WORLD_W, H / WORLD_H) * 0.92;
      return {
        x: (W - WORLD_W * z) / 2,
        y: (H - WORLD_H * z) / 2,
        z: z,
      };
    }

    // Chain pose: bbox of the chain's nodes (vert→mfr→brand→product),
    // padded for label space, fit into 84% of the canvas so there's
    // visual breathing room. Floor on z (1.0) keeps the camera from
    // pulling out further than ~2x the wide pose for unusually long
    // radial chains; ceiling (7.5) prevents over-zoom on tight ones.
    function computeChainFrame(node) {
      if (!node || !parentMap) return { x: 0, y: 0, z: 1 };
      const chain = ancestorChainOf(node, parentMap).filter(n => n.type !== 'root');
      if (!chain.length) return { x: 0, y: 0, z: 1 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of chain) {
        const padR = (n.r || 6) + 6;
        const padTop = (n.r || 6) + 32;
        const padBot = (n.r || 6) + 6;
        if (n.x - padR < minX) minX = n.x - padR;
        if (n.y - padTop < minY) minY = n.y - padTop;
        if (n.x + padR > maxX) maxX = n.x + padR;
        if (n.y + padBot > maxY) maxY = n.y + padBot;
      }
      const spanX = Math.max(40, maxX - minX);
      const spanY = Math.max(40, maxY - minY);
      const fitFraction = 0.84;
      const zX = (W * fitFraction) / spanX;
      const zY = (H * fitFraction) / spanY;
      const z = Math.max(1.0, Math.min(7.5, Math.min(zX, zY)));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return {
        x: W / 2 - cx * z,
        y: H / 2 - cy * z,
        z: z,
      };
    }

    // Node frame: center the canvas on `node` at the given zoom.
    // Used by the segment-phase tick to pan the camera to whichever
    // chain node is currently active. Centering each newly lit node
    // guarantees its label sits in the upper half of the canvas
    // (label clearance) and gives every activation a visible cinematic
    // arrival rather than a static "fits the whole chain" bbox shot.
    function computeNodeFrame(node, z) {
      return {
        x: W / 2 - node.x * z,
        y: H / 2 - node.y * z,
        z: z,
      };
    }

    // ===================================================================
    // Chain resolution
    // ===================================================================

    function resolveChains() {
      chains = [];
      for (const def of CHAIN_DEFS) {
        const v = nodes.find(n => n.type === 'vertical' && n.label === def.vertical);
        if (!v) continue;
        let p = nodes.find(n =>
          n.type === 'product' &&
          n.vertical === def.vertical &&
          n.label === def.product);
        if (!p) {
          // Fallback: first product in this vertical so the reel
          // never gaps a segment if a label drifts in the data.
          p = nodes.find(n => n.type === 'product' && n.vertical === def.vertical);
        }
        if (!p) continue;
        // Walk parentMap up from product to assemble the full chain.
        // Normal: [vert, mfr, brand, product]. "Independent /
        // Unattributed" buckets attach brand directly to vertical, so
        // chain length can be 3; the activation loop adapts.
        const fullChain = ancestorChainOf(p, parentMap).filter(n => n.type !== 'root');
        chains.push({
          def: def,
          chain: fullChain,
          product: p,
          frame: computeChainFrame(p),
        });
      }
      CYCLE_DURATION_S = WIDE_HOLD_S + chains.length * SEG_DUR_S + TAIL_DUR_S;
    }

    function recomputeFrames() {
      wideFrame = computeWideFrame();
      for (const c of chains) c.frame = computeChainFrame(c.product);
    }

    // ===================================================================
    // Info card (mobile-only DOM mirror)
    // ===================================================================

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }

    // Mirrors the desktop updateInfoPanel() output structure (name +
    // meta + trail) so the existing global .onto-info-* CSS classes
    // give the card the same look. Self-contained: no shared code
    // with desktop, so refactoring desktop won't accidentally break
    // the mobile reel and vice versa.
    function formatCard(node) {
      if (!node || node.type === 'root') return '';
      const trail = ancestorChainOf(node, parentMap)
        .filter(n => n.type !== 'root' && n.id !== node.id)
        .map(n => n.label)
        .join('  \u203A  ');
      const cc = node.childCount || 0;
      const childLabel = node.type === 'vertical' ? 'manufacturer'
        : node.type === 'manufacturer' ? 'brand'
        : node.type === 'brand' ? 'product' : '';
      const cs = cc > 0 && childLabel
        ? cc + ' ' + childLabel + (cc === 1 ? '' : 's')
        : '';
      return '<div class="onto-info-name" style="color:' + node.color + '">' +
          escapeHtml(node.label) +
        '</div>' +
        '<div class="onto-info-meta">' +
          '<span class="onto-info-type">' + escapeHtml(node.type) + '</span>' +
          (cs ? ' &middot; <span class="onto-info-count">' + escapeHtml(cs) + '</span>' : '') +
        '</div>' +
        (trail ? '<div class="onto-info-trail">' + escapeHtml(trail) + '</div>' : '');
    }

    // 160ms opacity-out, swap innerHTML, opacity-in. De-dupes by
    // node id so consecutive ticks for the same active node don't
    // re-trigger the fade. Pass null to clear (segment end / loop).
    function crossFadeCardTo(node) {
      if (!cardEl) return;
      const newId = node ? node.id : null;
      if (newId === lastCardId) return;
      lastCardId = newId;
      if (cardFadeTimeout) { clearTimeout(cardFadeTimeout); cardFadeTimeout = null; }
      cardEl.style.transition = 'opacity 160ms ease-out';
      cardEl.style.opacity = '0';
      cardFadeTimeout = setTimeout(() => {
        cardFadeTimeout = null;
        cardEl.innerHTML = node ? formatCard(node) : '';
        cardEl.style.opacity = node ? '1' : '0';
      }, 160);
    }

    // ===================================================================
    // Activation pulse — expanding ring, additive blend, drawn in
    // screen space after drawOntologyGraph so it stays crisp regardless
    // of camera zoom and is GC'd when expired.
    // ===================================================================

    function spawnPulseAt(node) {
      pulses.push({ node: node, born: performance.now(), lifeMs: PULSE_LIFE_MS });
    }

    function drawPulses(now) {
      if (!pulses.length) return;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of pulses) {
        const t = (now - p.born) / p.lifeMs;
        if (t < 0 || t > 1) continue;
        const eased = 1 - Math.pow(1 - t, 3);
        const sx = p.node.x * cam.z + cam.x;
        const sy = p.node.y * cam.z + cam.y;
        const baseR = Math.max(8, (p.node.r || 6) * cam.z);
        const radius = baseR * (1 + eased * 4);
        const alpha = 0.55 * (1 - eased);
        ctx.strokeStyle = colorWithAlpha(p.node.color, alpha);
        ctx.lineWidth = 1.6 + 1.4 * (1 - eased);
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // ===================================================================
    // Easing
    // ===================================================================

    function quartInOut(t) {
      return t < 0.5
        ? 8 * t * t * t * t
        : 1 - Math.pow(-2 * t + 2, 4) / 2;
    }
    function quartOut(t) { return 1 - Math.pow(1 - t, 4); }

    // ===================================================================
    // Tick — single continuous timeline driver
    // ===================================================================

    let raf = null;
    let running = false;
    // First-boot vs resume distinction. The IntersectionObserver and
    // visibilitychange hooks call start() every time the canvas
    // re-enters the viewport / tab refocuses; without this flag, every
    // such resume would wipe the timeline back to the wide opener.
    let hasBootedReel = false;
    // performance.now() at the moment we paused. On resume we shift
    // every stored absolute timestamp forward by (now - pauseStartedAt)
    // so the timeline (cycle, fade, pulses, edge draws) continues from
    // exactly where it left off instead of jumping.
    let pauseStartedAt = 0;

    function tick(now) {
      if (!running) return;

      // Loop wrap. Camera is already at wide pose (tail just panned
      // there) so resetting state produces no visible jump.
      let t = (now - cycleStartMs) / 1000;
      if (t >= CYCLE_DURATION_S) {
        cycleStartMs = now;
        t = 0;
        currentSegIdx = -2;
        currentChainProg = 0;
        edgeAnims.clear();
        pulses.length = 0;
        activeNode = null;
        crossFadeCardTo(null);
      }

      // Resolve current phase from t.
      let phase, segIdx, segElapsed = 0;
      if (t < WIDE_HOLD_S) {
        phase = 'wide';
        segIdx = -1;
      } else if (t < WIDE_HOLD_S + chains.length * SEG_DUR_S) {
        phase = 'segment';
        const tInSegs = t - WIDE_HOLD_S;
        segIdx = Math.floor(tInSegs / SEG_DUR_S);
        segElapsed = tInSegs - segIdx * SEG_DUR_S;
      } else {
        phase = 'tail';
        segIdx = chains.length;
        segElapsed = t - WIDE_HOLD_S - chains.length * SEG_DUR_S;
      }

      // Phase transition: snapshot the current camera as prevPose so
      // the tail can lerp deterministically from it. Segment phase
      // uses smooth low-pass filtering so it doesn't need an explicit
      // source pose. Clear all segment-local state.
      if (segIdx !== currentSegIdx) {
        prevPose = { x: cam.x, y: cam.y, z: cam.z };
        currentSegIdx = segIdx;
        currentChainProg = 0;
        edgeAnims.clear();
        activeNode = null;
        crossFadeCardTo(null);
      }

      // Camera pose for this frame.
      if (phase === 'wide') {
        // Wide hold: snap to the precomputed wide frame.
        cam.x = wideFrame.x;
        cam.y = wideFrame.y;
        cam.z = wideFrame.z;
      } else if (phase === 'segment') {
        // Track the most recently activated node. Before vertical
        // activates (currentChainProg=0), aim at chain[0] so the
        // camera is already gliding toward the vertical when it pulses.
        const ch = chains[segIdx];
        const trackIdx = currentChainProg > 0 ? currentChainProg - 1 : 0;
        const trackNode = ch.chain[trackIdx];
        const baseTarget = computeNodeFrame(trackNode, ch.frame.z);

        // Subtle ken-burns drift on the target. Smooth lerp smears
        // it across pan transitions naturally; on a held node it
        // reads as quiet breath. ~6px pan, ~2% zoom, coprime periods.
        const driftX = Math.sin(segElapsed * 0.32) * 6;
        const driftY = Math.cos(segElapsed * 0.27) * 4;
        const zoomMod = 1 + Math.sin(segElapsed * 0.21) * 0.02;
        const target = {
          x: baseTarget.x + driftX,
          y: baseTarget.y + driftY,
          z: baseTarget.z * zoomMod,
        };

        // Smooth low-pass filter toward target. The same filter
        // handles three motions cleanly: (1) initial pan-in from the
        // previous segment's last node, (2) per-activation pan to the
        // newly lit node, (3) gentle ken-burns drift while holding.
        cam.x += (target.x - cam.x) * CAM_LERP_RATE;
        cam.y += (target.y - cam.y) * CAM_LERP_RATE;
        cam.z += (target.z - cam.z) * CAM_LERP_RATE;

        // Activation triggers for this segment.
        const maxAct = Math.min(ch.chain.length, ACTIVATIONS_S.length);
        for (let i = 0; i < maxAct; i++) {
          if (segElapsed >= ACTIVATIONS_S[i] && currentChainProg < (i + 1)) {
            currentChainProg = i + 1;
            const node = ch.chain[i];
            activeNode = node;
            spawnPulseAt(node);
            crossFadeCardTo(node);
            if (i > 0) {
              // Animate the link from chain[i-1] → chain[i]. The
              // vertex itself (i=0) has no incoming chain edge to
              // draw, so we skip the edgeAnim there.
              const a = ch.chain[i - 1], b = ch.chain[i];
              edgeAnims.set(a.id + '->' + b.id, { startMs: now, durMs: EDGE_ANIM_DUR_MS });
            }
          }
        }
      } else if (phase === 'tail') {
        // Pull back to wide pose over TAIL_DUR_S with explicit lerp
        // so cam lands EXACTLY on wideFrame at the loop wrap (a
        // smooth filter would leave residual error and the loop
        // wouldn't be seamless).
        const k = quartInOut(Math.min(1, segElapsed / TAIL_DUR_S));
        cam.x = prevPose.x + (wideFrame.x - prevPose.x) * k;
        cam.y = prevPose.y + (wideFrame.y - prevPose.y) * k;
        cam.z = prevPose.z + (wideFrame.z - prevPose.z) * k;
        currentChainProg = 0;
      }

      // Build the per-frame edge-draw progress map (chain edges only).
      let edgeDrawMap = null;
      if (edgeAnims.size) {
        edgeDrawMap = new Map();
        for (const [key, anim] of edgeAnims) {
          edgeDrawMap.set(key, quartOut(Math.min(1, (now - anim.startMs) / anim.durMs)));
        }
      }

      // Fade-in only on the first cold start. After loop wrap the
      // camera is already at wide and fadeAlpha stays at 1 — keeps
      // the loop seamless.
      const fadeT = Math.min(1, (now - fadeStartedAt) / FADE_IN_MS);
      const fadeAlpha = quartOut(fadeT);

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#08090d';
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = fadeAlpha;
      drawOntologyGraph(ctx, nodes, edges, parentMap, cam, DPR, W, H, {
        chainNode: phase === 'segment' ? chains[segIdx].product : null,
        chainProgress: phase === 'segment' ? currentChainProg : 0,
        edgeDrawProgress: edgeDrawMap,
        labelChain: true,
      });
      ctx.restore();

      drawPulses(now);
      // GC expired pulses.
      if (pulses.length) {
        let write = 0;
        for (let read = 0; read < pulses.length; read++) {
          if (now - pulses[read].born < pulses[read].lifeMs) {
            pulses[write++] = pulses[read];
          }
        }
        pulses.length = write;
      }

      raf = requestAnimationFrame(tick);
    }

    function start() {
      if (running || !chains.length) return;
      running = true;
      const now = performance.now();
      if (!hasBootedReel) {
        // Cold start: initialize the timeline.
        hasBootedReel = true;
        cycleStartMs = now;
        fadeStartedAt = now;
        cam.x = wideFrame.x;
        cam.y = wideFrame.y;
        cam.z = wideFrame.z;
        currentSegIdx = -2;
        currentChainProg = 0;
        edgeAnims.clear();
        pulses.length = 0;
        activeNode = null;
        lastCardId = null;
        if (cardEl) {
          cardEl.style.opacity = '0';
          cardEl.innerHTML = '';
        }
      } else if (pauseStartedAt) {
        // Resume from a scroll-out or tab-hide. Shift every absolute
        // timestamp forward by the paused duration so (now - ts) is
        // identical to what it was at pause time. The cycle, the
        // current segment, in-flight edge animations, live pulses,
        // and the visible card are all preserved.
        const delta = now - pauseStartedAt;
        cycleStartMs += delta;
        fadeStartedAt += delta;
        for (let i = 0; i < pulses.length; i++) pulses[i].born += delta;
        for (const anim of edgeAnims.values()) anim.startMs += delta;
        pauseStartedAt = 0;
      }
      raf = requestAnimationFrame(tick);
    }

    function stop() {
      if (!running) return;
      running = false;
      pauseStartedAt = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }

    // ===================================================================
    // Reduced-motion: render the wide composition as a single static
    // frame. All chain effects disabled (no chain highlight, no link
    // anim, no pulses, empty card). No requestAnimationFrame loop.
    // ===================================================================

    function renderStaticFrame() {
      cam.x = wideFrame.x;
      cam.y = wideFrame.y;
      cam.z = wideFrame.z;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = '#08090d';
      ctx.fillRect(0, 0, W, H);
      drawOntologyGraph(ctx, nodes, edges, parentMap, cam, DPR, W, H, {
        chainNode: null,
        labelChain: true,
      });
      if (cardEl) {
        cardEl.style.opacity = '0';
        cardEl.innerHTML = '';
      }
    }

    // ===================================================================
    // Pause / resume hooks (viewport + tab visibility)
    // ===================================================================

    function isOnScreen(el) {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }

    let intersecting = false;
    let io = null;

    function onVisibility() {
      if (document.hidden) stop();
      else if (intersecting && chains.length) start();
    }

    // Resize: node positions are in WORLD coords (1024x900) so we do
    // NOT rebuild the graph or re-bake the sim. We only recompute the
    // camera frames against the new canvas size and snap to wide so a
    // mid-pan doesn't strand the camera in stale projection math.
    let resizeRaf = null;
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        DPR = Math.min(window.devicePixelRatio || 1, 1.5);
        const wasRunning = running;
        stop();
        resize();
        if (chains.length) {
          recomputeFrames();
          cam.x = wideFrame.x;
          cam.y = wideFrame.y;
          cam.z = wideFrame.z;
          currentSegIdx = -2;
        }
        if (reduced) renderStaticFrame();
        else if (wasRunning) start();
      });
    });

    document.addEventListener('visibilitychange', onVisibility);

    // ===================================================================
    // Boot
    // ===================================================================

    fetch('data/ontology.json').then(r => r.json()).then((tree) => {
      canvas.style.touchAction = 'auto';
      resize();

      // Build & bake against the VIRTUAL world dims, not canvas dims.
      // skipProducts: false because the timeline lights up products
      // as chain leaves (Juvederm Vollure XC, etc.).
      const built = buildOntologyGraph(tree, WORLD_W, WORLD_H, { skipProducts: false });
      nodes = built.nodes;
      edges = built.edges;
      parentMap = buildParentMap(edges);

      // Pre-bake the force sim synchronously. Blocks the main thread
      // briefly but the canvas is still on first paint so the user
      // sees a black canvas during the bake — acceptable cold start.
      const bakeAlpha = { alpha: 1 };
      let steps = 0;
      while (bakeAlpha.alpha > ONTO_ALPHA_MIN + 0.001 && steps < 800) {
        stepOntologyForce(nodes, edges, WORLD_W, WORLD_H, bakeAlpha);
        steps++;
      }

      resolveChains();
      wideFrame = computeWideFrame();

      // Counts only — the canvas-painted labels carry the proper
      // nouns (and the mobile card mirrors them on activation, by
      // explicit user request — see header comment).
      const counts = { vertical: 0, manufacturer: 0, brand: 0, product: 0 };
      for (const n of nodes) if (counts[n.type] !== undefined) counts[n.type]++;
      canvas.setAttribute('aria-label',
        'Vatico aesthetics ontology — ' +
        counts.vertical + ' verticals, ' +
        counts.manufacturer + ' manufacturers, ' +
        counts.brand + ' brands, ' +
        counts.product + ' products tracked.');

      if (reduced) {
        renderStaticFrame();
        return;
      }

      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          intersecting = entry.isIntersecting;
          if (intersecting && !document.hidden) start();
          else stop();
        }
      }, { threshold: 0.05 });
      io.observe(canvas);

      if (isOnScreen(canvas)) {
        intersecting = true;
        start();
      }
    }).catch((err) => {
      console.warn('reel boot failed', err);
      resize();
      ctx.fillStyle = '#08090d';
      ctx.fillRect(0, 0, W, H);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
