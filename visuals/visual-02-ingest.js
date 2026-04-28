/* ============================================================
   Visual 02 — Signal flow (rebuilt)
   Chaotic colored pixels on the left, drifting in. They are
   pulled through a central Vatico ingestion node, then emerge
   on the right into a structured cluster of horizontal bands —
   one band per vertical, same brand color spectrum as the
   ontology graph below.
   No container, no labels on the input — just pixels.
   Full-bleed.
   ============================================================ */

(function () {
  const VERTICALS = [
    { key: "injectable",      color: "#e74c3c" },
    { key: "laser",           color: "#9b59b6" },
    { key: "body_contouring", color: "#f39c12" },
    { key: "skin_treatment",  color: "#3498db" },
    { key: "wellness",        color: "#2ecc71" },
    { key: "cosmetic",        color: "#e67e22" },
  ];

  function init() {
    const root = document.getElementById('signal-flow');
    if (!root) return;
    const canvas = root.querySelector('.sf-canvas');
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0;
    // DPR cap: phones often report 3x. We never need more than 2x for
    // pixel art; under 768px CSS we cap at 1.5 to halve fill cost.
    const DPR_CAP = window.innerWidth < 768 ? 1.5 : 2;
    const DPR = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    let particles = [];
    let raf = null;

    // ----- Geometry zones -----
    // We split the stage into three bands:
    //   raw:    [0  .. 0.42*W]    — particles spawn here, randomly
    //   ingest: [0.42 .. 0.50*W]  — funnel into the ingest node
    //   sorted: [0.50 .. 1.0*W]   — particles fan out into vertical bands
    // The Vatico ingestion node lives at x ≈ 0.46*W, y = H/2.
    function zones() {
      const t = window.SF_TWEAKS || {};
      const yOffsetPct = (t.ingestYOffset != null ? t.ingestYOffset : 0) / 100;
      return {
        rawX0: 0,
        rawX1: W * 0.40,
        ingX:  W * 0.47,
        ingY:  H / 2 + H * yOffsetPct,
        sortX0: W * 0.55,
        sortX1: W,
      };
    }

    function bandY(verticalIdx) {
      // Distribute the 6 verticals evenly across the height with padding
      const n = VERTICALS.length;
      const pad = H * 0.10;
      const usable = H - 2 * pad;
      return pad + (verticalIdx + 0.5) * (usable / n);
    }

    // ----- Particle lifecycle -----
    // state 0 = drifting in raw zone (chaotic random walk)
    // state 1 = pulled toward ingest node
    // state 2 = inside ingest (briefly held, "processed")
    // state 3 = ejected toward target band on right, settles into row
    function spawn(p) {
      const z = zones();
      const v = (Math.random() * VERTICALS.length) | 0;
      p.color = VERTICALS[v].color;
      p.vertical = v;
      // Random start anywhere in the raw zone (full height)
      p.x = z.rawX0 + Math.random() * (z.rawX1 - z.rawX0);
      p.y = Math.random() * H;
      p.vx = (Math.random() - 0.4) * 0.4;  // slight rightward bias
      p.vy = (Math.random() - 0.5) * 0.4;
      p.state = 0;
      p.life = 0;
      p.maxLife = 80 + Math.random() * 220;  // frames before getting pulled in
      p.size = (window.SF_TWEAKS && window.SF_TWEAKS.particleSize ? window.SF_TWEAKS.particleSize : 3) + (Math.random() < 0.35 ? 1 : 0);
      // Each particle is destined for a slot in its band — settle position
      p.targetX = z.sortX0 + 60 + Math.random() * (z.sortX1 - z.sortX0 - 80);
      p.targetY = bandY(v) + (Math.random() - 0.5) * H * 0.06;
      p.alpha = 0.0;
      p.brightness = 0.6 + Math.random() * 0.4;
    }

    function build() {
      // Particle budget scales with stage area. On phones (<480 CSS px)
      // we halve the count: the small stage doesn't read as denser, and
      // the per-frame cost drops in lockstep.
      const mobileFactor = window.innerWidth < 480 ? 0.5 : 1;
      const Nbase = Math.min(1400, Math.max(600, Math.round((W * H) / 1100)));
      const N = Math.max(200, Math.round(Nbase * mobileFactor));
      particles = new Array(N);
      for (let i = 0; i < N; i++) {
        particles[i] = {};
        spawn(particles[i]);
        // Stagger initial states so the system is in motion immediately
        const r = Math.random();
        if (r > 0.65) {
          particles[i].state = 1;
          particles[i].life = particles[i].maxLife;
        } else if (r > 0.45) {
          particles[i].state = 3;
          // start partway along the right side
          const z = zones();
          particles[i].x = z.ingX + Math.random() * (z.sortX1 - z.ingX);
          particles[i].y = particles[i].targetY + (Math.random() - 0.5) * 80;
        } else {
          particles[i].life = Math.random() * particles[i].maxLife;
        }
        particles[i].alpha = 0.55 + Math.random() * 0.4;
      }
    }

    function resize() {
      const rect = root.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width  = W * DPR;
      canvas.height = H * DPR;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      // Position the ingest glyph
      const ing = root.querySelector('.sf-ingest');
      if (ing) {
        const z = zones();
        ing.style.left = z.ingX + 'px';
        ing.style.top  = z.ingY + 'px';
      }
      // Position vertical band labels on the right
      let bands = root.querySelector('.sf-bands');
      if (!bands) {
        bands = document.createElement('div');
        bands.className = 'sf-bands';
        root.appendChild(bands);
      }
      bands.innerHTML = '';
      VERTICALS.forEach((v, i) => {
        const el = document.createElement('div');
        el.className = 'sf-band';
        el.style.left = (W - 28) + 'px';
        el.style.top  = bandY(i) + 'px';
        el.style.setProperty('--c', v.color);
        el.textContent = v.key.replace('_', ' ');
        bands.appendChild(el);
      });
      build();
    }

    function frame() {
      // Mild trail: fast-decaying afterglow so motion is visible but doesn't smear
      ctx.fillStyle = 'rgba(8, 9, 13, 0.55)';
      ctx.fillRect(0, 0, W, H);
      const z = zones();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (p.state === 0) {
          // Random walk in raw zone, with mild drift right
          p.life++;
          p.vx += (Math.random() - 0.5) * 0.20;
          p.vy += (Math.random() - 0.5) * 0.20;
          p.vx = Math.max(-0.7, Math.min(1.0, p.vx));
          p.vy = Math.max(-0.7, Math.min(0.7, p.vy));
          p.x += p.vx;
          p.y += p.vy;
          // Wrap inside raw zone vertically
          if (p.y < 0) p.y = H;
          if (p.y > H) p.y = 0;
          if (p.x < z.rawX0) p.x = z.rawX0;
          // Once life expires, get pulled in
          if (p.life > p.maxLife || p.x > z.rawX1 - 6) p.state = 1;
        } else if (p.state === 1) {
          // Ease toward ingest node
          const dx = z.ingX - p.x;
          const dy = z.ingY - p.y;
          const d = Math.sqrt(dx*dx + dy*dy);
          const accel = 0.06;
          p.vx += (dx / Math.max(d, 0.001)) * accel;
          p.vy += (dy / Math.max(d, 0.001)) * accel;
          p.vx *= 0.92;
          p.vy *= 0.92;
          p.x += p.vx;
          p.y += p.vy;
          if (d < 14) {
            p.state = 2;
            p.life = 0;
          }
        } else if (p.state === 2) {
          // Briefly held at center, then ejected
          p.x = z.ingX + (Math.random() - 0.5) * 6;
          p.y = z.ingY + (Math.random() - 0.5) * 6;
          p.life++;
          if (p.life > 6 + Math.random() * 10) {
            p.state = 3;
            // Initial velocity: rightward
            p.vx = 1.4 + Math.random() * 0.6;
            // Aim toward the target band's Y
            const dy = p.targetY - p.y;
            p.vy = dy * 0.04;
          }
        } else if (p.state === 3) {
          // Travel toward target row, decelerating into place
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          // Apply spring-ish behavior on Y, less on X
          p.vx += dx * 0.0008;
          p.vy += dy * 0.012;
          p.vx *= 0.965;
          p.vy *= 0.85;
          p.x += p.vx;
          p.y += p.vy;
          // When settled, recycle to a fresh raw particle (preserves density)
          const settled = Math.abs(dx) < 4 && Math.abs(p.vx) < 0.08 && Math.abs(p.vy) < 0.08;
          if (settled || p.x > z.sortX1 + 20) {
            // small chance to fade then respawn — gives the bands a slow refresh
            if (Math.random() < 0.012) {
              spawn(p);
            }
          }
        }

        // Draw the pixel
        const c = p.color;
        const r = parseInt(c.slice(1,3),16) | 0;
        const g = parseInt(c.slice(3,5),16) | 0;
        const b = parseInt(c.slice(5,7),16) | 0;
        let a = p.alpha * p.brightness;
        // Boost saturation/alpha when going through ingest
        if (p.state === 1) a = 0.7 + 0.3 * Math.random();
        if (p.state === 2) a = 1.0;
        if (p.state === 3) a = Math.min(1.0, p.alpha + 0.25);
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
        const sz = p.size;
        ctx.fillRect(p.x | 0, p.y | 0, sz, sz);

        // Subtle glow for state 2/3 leading edge
        if (p.state === 2 || (p.state === 3 && Math.abs(p.vx) > 0.6)) {
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.18)';
          ctx.fillRect((p.x | 0) - 1, (p.y | 0) - 1, sz + 2, sz + 2);
        }
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    }

    let rt = null;
    const onResize = () => {
      if (rt) cancelAnimationFrame(rt);
      rt = requestAnimationFrame(resize);
    };
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(onResize);
      ro.observe(root);
    }

    // Wait for fonts + layout to settle before first measure.
    const start = () => {
      resize();
      if (reduced) frame();
      else raf = requestAnimationFrame(frame);
    };
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(start);
    } else {
      requestAnimationFrame(start);
    }
    // Re-measure once more after a short delay in case layout shifts.
    setTimeout(resize, 250);
    setTimeout(resize, 800);

    // Expose to tweak controls so they can re-place the glyph live.
    window.signalFlowResize = resize;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
