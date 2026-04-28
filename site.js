// Vatico site — scroll progress, reveals, rail label sync, door canvas.
(function () {
  function init() {
    document.body.classList.add('js-ready');

    // ---------- Word-by-word reveal (auto-applied to display type) ----------
    const wordSelectors = [
      '.sec-h2',
      '.alt-fragment',
      '.inflection-punch',
      '.inflection-correction',
      '.alt-close-row.big',
    ];
    document.querySelectorAll(wordSelectors.join(',')).forEach(el => {
      if (el.dataset.split === '1') return;
      // Split only top-level text nodes + simple inline children into words.
      // Nested elements (like <span class="ink-blue">) are preserved as single "words".
      const frag = document.createDocumentFragment();
      let i = 0;
      const walk = (node, parent) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const parts = node.nodeValue.split(/(\s+)/);
          for (const p of parts) {
            if (!p) continue;
            if (/^\s+$/.test(p)) {
              parent.appendChild(document.createTextNode(p));
            } else {
              const w = document.createElement('span');
              w.className = 'w';
              w.style.setProperty('--i', i++);
              w.textContent = p;
              parent.appendChild(w);
            }
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'BR') {
            parent.appendChild(node.cloneNode(false));
            return;
          }
          const clone = node.cloneNode(false);
          // If element has only text children, wrap the whole thing as one word.
          const hasOnlyText = Array.from(node.childNodes).every(c => c.nodeType === Node.TEXT_NODE);
          if (hasOnlyText && node.textContent.trim()) {
            const w = document.createElement('span');
            w.className = 'w';
            w.style.setProperty('--i', i++);
            clone.textContent = node.textContent;
            w.appendChild(clone);
            parent.appendChild(w);
          } else {
            node.childNodes.forEach(child => walk(child, clone));
            parent.appendChild(clone);
          }
        }
      };
      el.childNodes.forEach(n => walk(n, frag));
      el.innerHTML = '';
      el.appendChild(frag);
      el.classList.add('word-reveal');
      el.dataset.split = '1';
    });

    // Observe every word-reveal element independently so nested ones (like
    // .asset-line-* inside a parent .reveal) still trigger on their own.
    const wrIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          wrIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -60px 0px' });
    document.querySelectorAll('.word-reveal').forEach(el => wrIO.observe(el));
    // Fallback sweep
    function sweepWordReveals() {
      const vh = window.innerHeight;
      document.querySelectorAll('.word-reveal:not(.in)').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < vh - 60 && r.bottom > 0) el.classList.add('in');
      });
    }
    window.addEventListener('scroll', sweepWordReveals, { passive: true });
    requestAnimationFrame(sweepWordReveals);
    setTimeout(sweepWordReveals, 200);

    // ---------- Reveal on scroll ----------
    const reveals = Array.from(document.querySelectorAll('.reveal'));
    const revealIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          revealIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => revealIO.observe(el));

    // Fallback: check on scroll + periodically. Any reveal whose top is within
    // the viewport gets `.in`. Safeguards against IO not firing on initial paint.
    function sweepReveals() {
      const vh = window.innerHeight;
      document.querySelectorAll('.reveal:not(.in)').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < vh - 40 && r.bottom > 0) el.classList.add('in');
      });
    }
    window.addEventListener('scroll', sweepReveals, { passive: true });
    window.addEventListener('resize', sweepReveals);
    // Run twice on load to catch late layout
    requestAnimationFrame(sweepReveals);
    setTimeout(sweepReveals, 120);
    setTimeout(sweepReveals, 600);

    // ---------- Scroll progress rail ----------
    const rail = document.querySelector('.scroll-rail');
    function onScroll() {
      const h = document.documentElement;
      const scroll = h.scrollTop || document.body.scrollTop;
      const total = h.scrollHeight - h.clientHeight;
      const pct = total > 0 ? (scroll / total) * 100 : 0;
      if (rail) rail.style.setProperty('--progress', pct + '%');
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // ---------- Rail label sync (tracks current section) ----------
    const railMark = document.querySelector('.rail-mark');
    const sections = Array.from(document.querySelectorAll('[data-index]'));
    // map data-index -> human label
    const labels = {
      '01': '01 · the asset',
      '02': '02 · the alternative',
      '03': '03 · in the index',
      '04': '04 · monday morning',
      '05': '05 · who reads',
      '06': '06 · the posture',
      '07': '07 · the inflection',
      '08': '08 · the door',
    };
    if (railMark && sections.length) {
      const sectIO = new IntersectionObserver((entries) => {
        // Pick entry closest to the viewport middle
        let bestEntry = null;
        let bestDistance = Infinity;
        entries.forEach(e => {
          if (e.isIntersecting) {
            const rect = e.target.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            const d = Math.abs(mid - window.innerHeight / 2);
            if (d < bestDistance) {
              bestDistance = d;
              bestEntry = e;
            }
          }
        });
        if (bestEntry) {
          const idx = bestEntry.target.getAttribute('data-index');
          const label = labels[idx] || 'index';
          if (railMark.getAttribute('data-label') !== label) {
            railMark.style.opacity = '0';
            setTimeout(() => {
              railMark.setAttribute('data-label', label);
              railMark.style.opacity = '0.6';
            }, 160);
          }
        }
      }, { threshold: [0.15, 0.5, 0.85] });
      sections.forEach(s => sectIO.observe(s));

      // Default label before any section is visible
      window.addEventListener('scroll', () => {
        if (window.scrollY < 200) {
          railMark.style.opacity = '0';
          setTimeout(() => {
            railMark.setAttribute('data-label', 'the aesthetics index');
            railMark.style.opacity = '0.6';
          }, 160);
        }
      }, { passive: true });
      railMark.setAttribute('data-label', 'the aesthetics index');
      railMark.style.opacity = '0.6';
    }

    // ---------- Door canvas (reuse hero-field seeding if present) ----------
    // Light, static-ish dot field — no pulses. Quiet bookend.
    const doorCanvas = document.getElementById('door-canvas');
    if (doorCanvas) initQuietField(doorCanvas);
  }

  function initQuietField(canvas) {
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dots = [], raf = null, tick = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nextW = Math.max(1, Math.round(rect.width));
      const nextH = Math.max(1, Math.round(rect.height));
      if (nextW === W && nextH === H) return;
      W = nextW; H = nextH;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      seed();
    }
    let resizeTimer = null;
    function scheduleResize() {
      if (resizeTimer) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(resize);
    }
    function seed() {
      const count = Math.min(220, Math.floor((W * H) / 9000));
      dots = [];
      for (let i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 1.1 + 0.3,
          a: Math.random() * 0.28 + 0.05,
          tw: Math.random() * Math.PI * 2,
          ts: 0.0015 + Math.random() * 0.0035,
        });
      }
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      tick++;
      for (const d of dots) {
        if (!reduced) d.tw += d.ts;
        const a = Math.max(0, Math.min(1, d.a + Math.sin(d.tw) * 0.12));
        ctx.beginPath();
        ctx.fillStyle = `rgba(136,146,176,${a})`;
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    window.addEventListener('resize', scheduleResize);
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { if (!raf) frame(); }
        else if (raf) { cancelAnimationFrame(raf); raf = null; }
      }
    }, { threshold: 0 });
    io.observe(canvas);
    resize();
    frame();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
