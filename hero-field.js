// Hero dot-field canvas — continuous, observed points with mouse parallax.
// Respects prefers-reduced-motion.

(function () {
  function initHeroField() {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
    let dots = [];
    let mouse = { x: 0.5, y: 0.5, active: false };
    let pulses = []; // occasional bright pulses
    let raf = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.round(rect.width));
      const nextH = Math.max(1, Math.round(rect.height));
      if (nextW === W && nextH === H) return;
      W = nextW; H = nextH;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seed();
    }
    let resizeTimer = null;
    function scheduleResize() {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(resize);
    }

    function seed() {
      const count = Math.min(320, Math.floor((W * H) / 7000));
      dots = [];
      for (let i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 1.3 + 0.3,
          baseAlpha: Math.random() * 0.35 + 0.08,
          twinkle: Math.random() * Math.PI * 2,
          twinkleSpeed: 0.002 + Math.random() * 0.004,
          driftX: (Math.random() - 0.5) * 0.06,
          driftY: (Math.random() - 0.5) * 0.06,
          parallax: Math.random() * 0.6 + 0.2,
        });
      }
    }

    function spawnPulse() {
      // Pick a random dot and send a "capture" ping out of it
      if (!dots.length) return;
      const d = dots[Math.floor(Math.random() * dots.length)];
      pulses.push({ x: d.x, y: d.y, r: 0, life: 1, maxR: 60 + Math.random() * 60 });
    }

    let tick = 0;
    function frame() {
      ctx.clearRect(0, 0, W, H);
      tick++;

      // Occasionally spawn a pulse
      if (!reduced && tick % 90 === 0 && Math.random() < 0.85) spawnPulse();

      // Draw dots
      const parX = (mouse.x - 0.5) * 14;
      const parY = (mouse.y - 0.5) * 14;

      for (const d of dots) {
        if (!reduced) {
          d.twinkle += d.twinkleSpeed;
          d.x += d.driftX;
          d.y += d.driftY;
          if (d.x < 0) d.x = W; else if (d.x > W) d.x = 0;
          if (d.y < 0) d.y = H; else if (d.y > H) d.y = 0;
        }
        const a = d.baseAlpha + Math.sin(d.twinkle) * 0.15;
        const alpha = Math.max(0, Math.min(1, a));
        const px = d.x + parX * d.parallax;
        const py = d.y + parY * d.parallax;
        ctx.beginPath();
        ctx.fillStyle = `rgba(136, 146, 176, ${alpha})`;
        ctx.arc(px, py, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw pulses (capture rings)
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.r += 1.2;
        p.life -= 0.012;
        if (p.life <= 0 || p.r > p.maxR) {
          pulses.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.strokeStyle = `rgba(59,130,246,${p.life * 0.7})`;
        ctx.lineWidth = 1;
        ctx.arc(p.x + parX * 0.3, p.y + parY * 0.3, p.r, 0, Math.PI * 2);
        ctx.stroke();

        // center highlight
        ctx.beginPath();
        ctx.fillStyle = `rgba(59,130,246,${p.life})`;
        ctx.arc(p.x + parX * 0.3, p.y + parY * 0.3, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('resize', scheduleResize);
    window.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left) / rect.width;
      mouse.y = (e.clientY - rect.top) / rect.height;
      mouse.active = true;
    });

    // Pause when off-screen
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!raf) frame();
        } else {
          if (raf) { cancelAnimationFrame(raf); raf = null; }
        }
      }
    }, { threshold: 0 });
    io.observe(canvas);

    resize();
    frame();

    // Expose a control handle for Tweaks
    window.__heroField = {
      pulse: spawnPulse,
      reseed: (densityFactor) => {
        // change density by re-seeding with scaled count
        const base = Math.min(320, Math.floor((W * H) / 7000));
        const n = Math.max(40, Math.floor(base * densityFactor));
        dots = [];
        for (let i = 0; i < n; i++) {
          dots.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: Math.random() * 1.3 + 0.3,
            baseAlpha: Math.random() * 0.35 + 0.08,
            twinkle: Math.random() * Math.PI * 2,
            twinkleSpeed: 0.002 + Math.random() * 0.004,
            driftX: (Math.random() - 0.5) * 0.06,
            driftY: (Math.random() - 0.5) * 0.06,
            parallax: Math.random() * 0.6 + 0.2,
          });
        }
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeroField);
  } else {
    initHeroField();
  }
})();
