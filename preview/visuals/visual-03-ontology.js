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
      ctx.clearRect(0, 0, W, H);

      // Edges
      for (const e of edges) {
        const a = e.a, b = e.b;
        const v = b.vertical || a.vertical;
        const dim = activeVertical && v && v !== activeVertical;
        const op = dim ? 0.04 : (e.w * 1.8);
        ctx.strokeStyle = colorWithAlpha(b.color, op);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        const dim = activeVertical && n.vertical && n.vertical !== activeVertical && n.type !== 'root';
        const op = dim ? 0.10 : (n.type === 'product' ? 0.55 : (n.type === 'brand' ? 0.75 : 0.95));
        ctx.beginPath();
        ctx.fillStyle = colorWithAlpha(n.color, op);
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels — verticals + manufacturers always; hovered shows full chain
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of nodes) {
        if (n.type === 'vertical') {
          ctx.fillStyle = activeVertical && n.label !== activeVertical ? 'rgba(228,232,244,0.25)' : '#e4e8f4';
          ctx.font = '800 12px Inter, system-ui, sans-serif';
          ctx.fillText(n.label, n.x, n.y - n.r - 8);
        }
      }
      if (hoveredNode) {
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#e4e8f4';
        ctx.strokeStyle = 'rgba(8,9,13,0.85)';
        ctx.lineWidth = 3;
        const lab = hoveredNode.label;
        ctx.strokeText(lab, hoveredNode.x, hoveredNode.y - hoveredNode.r - 8);
        ctx.fillText(lab, hoveredNode.x, hoveredNode.y - hoveredNode.r - 8);
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
      simTime += dt;
      if (!settled) {
        for (let k = 0; k < 2; k++) step();
        if (simTime > SIM_BUDGET_MS || alpha <= alphaMin + 0.001) {
          settled = true;
        }
      }
      draw();
      raf = requestAnimationFrame(loop);
    }

    function pickNode(mx, my) {
      let best = null, bestD2 = 16 * 16;
      for (const n of nodes) {
        const dx = n.x - mx, dy = n.y - my;
        const d2 = dx * dx + dy * dy;
        const r2 = Math.max(64, (n.r + 6) * (n.r + 6));
        if (d2 < r2 && d2 < bestD2) { best = n; bestD2 = d2; }
      }
      return best;
    }

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      hoveredNode = pickNode(mx, my);
      if (labelEl) {
        if (hoveredNode) {
          labelEl.textContent = (hoveredNode.parentLabel ? hoveredNode.parentLabel + ' / ' : '') + hoveredNode.label;
          labelEl.style.color = hoveredNode.color;
        } else {
          labelEl.textContent = '';
        }
      }
      canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', () => { hoveredNode = null; if (labelEl) labelEl.textContent = ''; });

    if (filterEl) {
      filterEl.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-vert]');
        if (!chip) return;
        const v = chip.dataset.vert;
        if (activeVertical === v) {
          activeVertical = null;
          filterEl.querySelectorAll('[data-vert]').forEach(c => c.classList.remove('active'));
        } else {
          activeVertical = v;
          filterEl.querySelectorAll('[data-vert]').forEach(c =>
            c.classList.toggle('active', c.dataset.vert === v));
        }
      });
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
      if (reduced) {
        // Run many sim steps off-screen then settle
        for (let k = 0; k < 220; k++) step();
        settled = true;
        draw();
      } else {
        raf = requestAnimationFrame(loop);
      }
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
