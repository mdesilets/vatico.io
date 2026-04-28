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

  function init() {
    const canvas = document.getElementById('ontology-canvas');
    if (!canvas) return;
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
    const parentMap = new Map();

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function ancestorIds(node) {
      const ids = new Set();
      let cur = node;
      while (cur) { ids.add(cur.id); cur = parentMap.get(cur.id) || null; }
      return ids;
    }
    function ancestorEdgeKeys(node) {
      const set = new Set();
      let cur = node;
      while (parentMap.has(cur.id)) {
        const p = parentMap.get(cur.id);
        set.add(p.id + '->' + cur.id);
        cur = p;
      }
      return set;
    }
    function ancestorChain(node) {
      const chain = [];
      let cur = node;
      while (cur) { chain.push(cur); cur = parentMap.get(cur.id) || null; }
      return chain.reverse();
    }
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

    function buildGraph(tree) {
      nodes = []; edges = [];
      const cx = W / 2, cy = H / 2;
      const root = { id: 'root', label: 'Aesthetics Index', type: 'root', color: '#5a6180',
                     x: cx, y: cy, vx: 0, vy: 0, r: 7, fixed: true, depth: 0, vertical: null,
                     childCount: tree.children.length };
      nodes.push(root);

      const verticalAngles = {};
      tree.children.forEach((vert, i) => {
        const angle = (i / tree.children.length) * Math.PI * 2 - Math.PI / 2;
        verticalAngles[vert.label] = angle;
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
          // The "Independent / Unattributed" bucket is the source extractor's
          // honest catch-all for brands without a manufacturer_id. We don't
          // render it as a visible node — orphan brands attach directly to
          // the vertical so the graph reads cleanly. Source data unchanged.
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
            // Spread orphans wider around the vertical so they don't all
            // pile at one angle (the unattributed bucket has no real angle).
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
              // Hover trail honors what's rendered, not what's in source.
              parentLabel: isUnattributedBucket ? vert.label : mfg.label,
            };
            nodes.push(bNode);
            edges.push({ a: parentNode, b: bNode, w: 0.12 });

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
          });
        });
      });
    }

    // Force simulation parameters
    const REPULSE = 80;
    const LINK_DIST = { 1: 120, 2: 60, 3: 36, 4: 22 };
    let alpha = 1, alphaDecay = 0.018, alphaMin = 0.02;

    function step() {
      const cx = W / 2, cy = H / 2;

      // Mild center gravity
      for (const n of nodes) {
        if (n.fixed) continue;
        n.vx += (cx - n.x) * 0.0008 * alpha;
        n.vy += (cy - n.y) * 0.0008 * alpha;
      }

      // Repulsion (O(N^2) on 734 nodes per ~60 frames is heavy; we run brief sim then settle)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 6400) continue;
          if (d2 < 0.01) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = dx * dx + dy * dy; }
          const d = Math.sqrt(d2);
          const f = REPULSE / d2 * alpha;
          dx /= d; dy /= d;
          if (!a.fixed) { a.vx -= dx * f; a.vy -= dy * f; }
          if (!b.fixed) { b.vx += dx * f; b.vy += dy * f; }
        }
      }

      // Link attraction
      for (const e of edges) {
        const a = e.a, b = e.b;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = LINK_DIST[b.depth] || 30;
        const f = (d - target) * 0.05 * alpha;
        const nx = dx / d, ny = dy / d;
        if (!a.fixed) { a.vx += nx * f; a.vy += ny * f; }
        if (!b.fixed) { b.vx -= nx * f; b.vy -= ny * f; }
      }

      // Integrate + friction + bounds
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

      alpha = Math.max(alphaMin, alpha - alphaDecay);
    }

    function draw() {
      // Reset to base DPR transform, clear in screen-space, then apply camera.
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.z, cam.z);

      const chainIds = hoveredNode ? ancestorIds(hoveredNode) : null;
      const chainEdges = hoveredNode ? ancestorEdgeKeys(hoveredNode) : null;

      // Edges
      for (const e of edges) {
        const a = e.a, b = e.b;
        const v = b.vertical || a.vertical;
        const isOnHoverChain = chainEdges && chainEdges.has(a.id + '->' + b.id);
        const dimByVertical = activeVertical && v && v !== activeVertical;
        const dimByHover = hoveredNode && !isOnHoverChain &&
          !chainIds.has(a.id) && !chainIds.has(b.id);
        let op;
        if (isOnHoverChain) op = 0.95;
        else if (dimByVertical || dimByHover) op = 0.04;
        else op = e.w * 1.8;
        ctx.strokeStyle = colorWithAlpha(b.color, op);
        ctx.lineWidth = isOnHoverChain ? 1.4 / cam.z : 0.5 / cam.z;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        const dimByVertical = activeVertical && n.vertical && n.vertical !== activeVertical && n.type !== 'root';
        const dimByHover = hoveredNode && !chainIds.has(n.id);
        const onChain = chainIds && chainIds.has(n.id);
        let op;
        if (onChain) op = 1.0;
        else if (dimByVertical || dimByHover) op = 0.10;
        else op = (n.type === 'product' ? 0.55 : (n.type === 'brand' ? 0.75 : 0.95));
        ctx.beginPath();
        ctx.fillStyle = colorWithAlpha(n.color, op);
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        // Ring on chain members for unmistakable focus
        if (onChain && n.type !== 'root') {
          ctx.strokeStyle = colorWithAlpha(n.color, 0.7);
          ctx.lineWidth = 2 / cam.z;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 3 / cam.z, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Labels — verticals always; hovered node shows its own.
      // Font sizes are divided by cam.z so they stay readable when zoomed.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of nodes) {
        if (n.type === 'vertical') {
          const dim = activeVertical && n.label !== activeVertical;
          const onChain = chainIds && chainIds.has(n.id);
          ctx.fillStyle = onChain ? '#ffffff' : (dim ? 'rgba(228,232,244,0.25)' : '#e4e8f4');
          const fz = (12 / cam.z).toFixed(2);
          ctx.font = '800 ' + fz + 'px Inter, system-ui, sans-serif';
          ctx.fillText(n.label, n.x, n.y - n.r - 8 / cam.z);
        }
      }
      if (hoveredNode && hoveredNode.type !== 'vertical' && hoveredNode.type !== 'root') {
        const fz = (11 / cam.z).toFixed(2);
        ctx.font = '700 ' + fz + 'px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e4e8f4';
        ctx.strokeStyle = 'rgba(8,9,13,0.85)';
        ctx.lineWidth = 3 / cam.z;
        const lab = hoveredNode.label;
        ctx.strokeText(lab, hoveredNode.x, hoveredNode.y - hoveredNode.r - 8 / cam.z);
        ctx.fillText(lab, hoveredNode.x, hoveredNode.y - hoveredNode.r - 8 / cam.z);
      }
    }

    function colorWithAlpha(hex, a) {
      const r = parseInt(hex.slice(1,3),16),
            g = parseInt(hex.slice(3,5),16),
            b = parseInt(hex.slice(5,7),16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
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
        if (simTime > SIM_BUDGET_MS || alpha <= alphaMin + 0.001) settled = true;
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

      // Discoverability hint, fades after 5s.
      const hintEl = document.createElement('div');
      hintEl.className = 'viz-onto-hint';
      hintEl.textContent = 'scroll to zoom \u00b7 drag to pan \u00b7 double-click to reset';
      frame.appendChild(hintEl);
      setTimeout(() => hintEl.classList.add('fade-out'), 5000);
      // Also fade the hint immediately on the first user interaction.
      const dismissHint = () => hintEl.classList.add('fade-out');
      canvas.addEventListener('mousedown', dismissHint, { once: true });
      canvas.addEventListener('wheel', dismissHint, { once: true });
    }

    fetch('data/ontology.json').then(r => r.json()).then(tree => {
      resize();
      buildGraph(tree);

      // Build the parent lookup once buildGraph has populated edges.
      parentMap.clear();
      for (const e of edges) parentMap.set(e.b.id, e.a);

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
