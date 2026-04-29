/* ============================================================
   Visual 07 — DMA whitespace leaderboard (rebuilt)
   The boundary GeoJSON only covers the southern half of CONUS;
   the choropleth misled. Replaced with a sortable leaderboard:
   each DMA shown as supply vs demand bars + score.

   Schema contract (data/dma_meta.json::field_definitions):
   - whitespace_eligible filters the leaderboard (high|medium coverage).
   - coverage_band and data_completeness_score drive the inline
     confidence badge so investors can see the math.
   - Low / insufficient coverage DMAs are intentionally hidden;
     they're tracked in dma_meta.rows_by_coverage_band.
   ============================================================ */

(function () {
  function init() {
    const root = document.getElementById('whitespace-root');
    if (!root) return;
    const tableEl = root.querySelector('.ws-table');
    const meta    = root.querySelector('.ws-meta');
    const filterEl= root.querySelector('.ws-filter');

    let data = null;
    let mode = 'whitespace'; // whitespace | demand | supply

    Promise.all([
      fetch('data/dma-whitespace.json?v=3').then(r => r.json()),
      fetch('data/dma-leader.json?v=3').then(r => r.json()),
    ]).then(([ws, ld]) => {
      const ldByCode = new Map(ld.map(d => [String(d.dma_code), d]));
      data = ws.map(d => ({
        ...d,
        leader: ldByCode.get(String(d.dma_code)) || null,
      }));
      render();
    }).catch(err => console.warn('whitespace load failed', err));

    if (filterEl) filterEl.addEventListener('click', (e) => {
      const c = e.target.closest('[data-mode]');
      if (!c) return;
      mode = c.dataset.mode;
      filterEl.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === c));
      render();
    });

    function render() {
      if (!data) return;
      // Per the Apr 2026 audit, the leaderboard only ranks DMAs with
      // high or medium coverage (>=15 indexed locations). 20 DMAs are
      // intentionally hidden — surfacing them with sparse counts
      // produced the "Watertown NY #1" artifact we just retired.
      const eligible = data.filter(d => d.whitespace_eligible);
      const ineligible = data.length - eligible.length;
      let rows = eligible.slice();
      if (mode === 'whitespace') rows.sort((a,b) => (b.white_space_score ?? -Infinity) - (a.white_space_score ?? -Infinity));
      else if (mode === 'demand') rows.sort((a,b) => (b.consumer_demand_proxy ?? 0) - (a.consumer_demand_proxy ?? 0));
      else if (mode === 'supply') rows.sort((a,b) => (b.injectable_supply_count ?? b.practice_supply_count ?? 0) - (a.injectable_supply_count ?? a.practice_supply_count ?? 0));
      // Phones get top-10 only — matches the CSS truncation rule and
      // saves us building 20 DOM rows that would only be visually
      // hidden anyway. Tablet+ keeps the full top-30 view.
      const cap = window.innerWidth < 768 ? 10 : 30;
      rows = rows.slice(0, cap);

      // Normalize bars within the displayed window. Global-max
      // normalization made small-market bars vanish (top-10 supply is
      // 5–25 vs LA's 1,729). In-window max keeps the relative shape
      // legible while the whitespace score column still carries the
      // absolute story.
      const maxSupply = Math.max(1, ...rows.map(d => supplyOf(d)));
      const maxDemand = Math.max(1, ...rows.map(d => d.consumer_demand_proxy || 0));
      const maxScore  = 5;

      let html = '<div class="ws-row ws-row-head">' +
                   '<div class="ws-rank">#</div>' +
                   '<div class="ws-name">Market</div>' +
                   '<div class="ws-bar-h">Practice supply</div>' +
                   '<div class="ws-bar-h">Consumer demand</div>' +
                   '<div class="ws-score-h">Whitespace</div>' +
                   '<div class="ws-leader-h">Leader</div>' +
                 '</div>';

      for (let i = 0; i < rows.length; i++) {
        const d = rows[i];
        const supply = supplyOf(d);
        const supplyPct = (supply / maxSupply) * 100;
        const demandPct = ((d.consumer_demand_proxy || 0) / maxDemand) * 100;
        const scoreVal  = d.white_space_score ?? 0;
        const scorePct  = (scoreVal / maxScore) * 100;
        const scoreColor = scoreColorFor(scoreVal);
        const leader = d.leader && d.leader.leader_brand
                        ? d.leader.leader_brand + ' · ' + Math.round((d.leader.leader_share||0)*100) + '%'
                        : '—';
        const band = d.coverage_band || 'high';
        const enrichedPct = Math.round((d.data_completeness_score || 0) * 100);
        const bandLabel = '<span class="ws-band ws-band-' + band + '" title="coverage band — see methodology">' + band + '</span>';
        const subline = 'rank ' + d.dma_rank + ' · ' + bandLabel + ' · ' + enrichedPct + '% enriched';
        html += '<div class="ws-row">' +
                  '<div class="ws-rank">' + String(i+1).padStart(2,'0') + '</div>' +
                  '<div class="ws-name"><b>' + d.dma_name + '</b><span>' + subline + '</span></div>' +
                  '<div class="ws-bar"><span style="width:' + supplyPct.toFixed(1) + '%;background:#3B82F6"></span><em>' + supply.toLocaleString() + '</em></div>' +
                  '<div class="ws-bar"><span style="width:' + demandPct.toFixed(1) + '%;background:#A855F7"></span><em>' + (d.consumer_demand_proxy||0).toFixed(2) + '</em></div>' +
                  '<div class="ws-score"><span style="width:' + scorePct.toFixed(1) + '%;background:' + scoreColor + '"></span><em>' + scoreVal.toFixed(2) + '</em></div>' +
                  '<div class="ws-leader">' + leader + '</div>' +
                '</div>';
      }
      tableEl.innerHTML = html;
      if (meta) {
        meta.textContent =
          rows.length + ' of ' + eligible.length + ' eligible DMAs shown · ' +
          ineligible + ' low-coverage markets excluded · ' +
          'whitespace = z-score(demand) − z-score(log10(1+supply)), bounded ±3';
      }
    }

    // Prefer the canonical Injectable count from the new schema; fall
    // back to the backward-compat alias for any stale local cache.
    function supplyOf(d) {
      return (d.injectable_supply_count ?? d.practice_supply_count ?? 0);
    }

    function scoreColorFor(s) {
      const t = Math.max(0, Math.min(1, s / 5));
      const stops = [
        [0.0, [231, 76, 60]],
        [0.5, [243, 156, 18]],
        [1.0, [46, 204, 113]],
      ];
      let lo=stops[0], hi=stops[stops.length-1];
      for (let i=0;i<stops.length-1;i++) if (t>=stops[i][0]&&t<=stops[i+1][0]) { lo=stops[i]; hi=stops[i+1]; break; }
      const k = (t-lo[0])/Math.max(0.0001,(hi[0]-lo[0]));
      const r = Math.round(lo[1][0]+(hi[1][0]-lo[1][0])*k);
      const g = Math.round(lo[1][1]+(hi[1][1]-lo[1][1])*k);
      const b = Math.round(lo[1][2]+(hi[1][2]-lo[1][2])*k);
      return 'rgb('+r+','+g+','+b+')';
    }
  }

  // Lazy-init: only construct the whitespace leaderboard when the
  // figure is within 200px of the viewport. V07 is in §05.
  function lazyInit() {
    const root = document.getElementById('whitespace-root');
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
