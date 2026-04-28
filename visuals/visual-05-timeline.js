/* ============================================================
   Visual 05 — Trailing-window leaderboard (rebuilt)
   Two years of monthly source data does not exist; the file has
   one full month and one partial. So we drop the fake "stacked
   over time" chart and present what the data actually supports:
   four trailing windows (30/60/90/365 d) as a brand leaderboard.
   ============================================================ */

(function () {
  const VERTICAL_FOR_BRAND = {
    Botox:'Toxins', Dysport:'Toxins', Xeomin:'Toxins', Jeuveau:'Toxins', Daxxify:'Toxins', Letybo:'Toxins',
    Juvederm:'Fillers', Restylane:'Fillers', Radiesse:'Fillers', RHA:'Fillers', Belotero:'Fillers', Sculptra:'Fillers'
  };

  function init() {
    const root = document.getElementById('timeline-root');
    if (!root) return;
    const tableEl = root.querySelector('.tw-table');
    const meta    = root.querySelector('.timeline-meta');
    const tabs    = root.querySelector('.tw-tabs');
    let activeWindow = '30d';
    let data = null;

    fetch('data/sov-neurotox.json').then(r => r.json()).then(s => {
      data = s.trailing_windows;
      render();
    }).catch(err => console.warn('leaderboard load failed', err));

    if (tabs) tabs.addEventListener('click', (e) => {
      const c = e.target.closest('[data-window]');
      if (!c) return;
      activeWindow = c.dataset.window;
      tabs.querySelectorAll('[data-window]').forEach(x => x.classList.toggle('active', x === c));
      render();
    });

    function render() {
      if (!data) return;
      const rows = data.filter(r => r.window === activeWindow)
                       .sort((a, b) => b.practice_count - a.practice_count);
      const max = rows.length ? rows[0].practice_count : 1;
      let html = '';
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const w = (r.practice_count / max) * 100;
        const sharePct = (r.share * 100).toFixed(1);
        const vertical = VERTICAL_FOR_BRAND[r.brand] || '—';
        html += '<div class="tw-row">' +
                  '<div class="tw-rank">' + String(i+1).padStart(2,'0') + '</div>' +
                  '<div class="tw-brand"><b>' + r.brand + '</b><span class="tw-mfg">' + r.manufacturer + '</span></div>' +
                  '<div class="tw-vert">' + vertical + '</div>' +
                  '<div class="tw-bar"><span style="width:' + w.toFixed(1) + '%;background:' + r.color_hex + '"></span></div>' +
                  '<div class="tw-count">' + r.practice_count.toLocaleString() + '</div>' +
                  '<div class="tw-share">' + sharePct + '%</div>' +
                '</div>';
      }
      tableEl.innerHTML = html;
      const totalPractices = rows.reduce((s, r) => s + r.practice_count, 0);
      if (meta) meta.textContent = rows.length + ' brands · ' + totalPractices.toLocaleString() + ' practice-mentions in trailing ' + activeWindow + ' · share against vertical total';
    }
  }

  // Lazy-init: only construct the timeline when the figure is within
  // 200px of the viewport. Saves work on first paint and keeps the
  // V05 fetch out of the critical-path waterfall.
  function lazyInit() {
    const root = document.getElementById('timeline-root');
    if (!root) return;
    if (typeof IntersectionObserver === 'undefined') { init(); return; }
    const io = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) { obs.disconnect(); init(); break; }
      }
    }, { rootMargin: '200px 0px' });
    io.observe(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lazyInit);
  else lazyInit();
})();
