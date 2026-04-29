/* ============================================================
   Visual 06 — Share-of-voice in Toxins
   Stacked horizontal bars (national share by month, from sov-neurotox.json),
   trend lines (same monthly source), and DMA leader rail (dma-leader.json).
   ============================================================ */

(function () {
  const TOXINS = ["Botox","Dysport","Xeomin","Jeuveau","Daxxify","Letybo"];
  const COLOR = {
    Botox:"#3B82F6", Dysport:"#A855F7", Xeomin:"#00A3E0",
    Jeuveau:"#10B981", Daxxify:"#F59E0B", Letybo:"#64748B"
  };

  function init() {
    const root = document.getElementById('sov-root');
    if (!root) return;
    const barsEl = root.querySelector('.sov-bars');
    const linesEl = root.querySelector('.sov-lines');
    const dmaEl = root.querySelector('.sov-dma');
    const meta = root.querySelector('.sov-meta');

    let sov = null, dmaLeaders = null;

    Promise.all([
      fetch('data/sov-neurotox.json?v=2').then(r => r.json()),
      fetch('data/dma-leader.json?v=2').then(r => r.json()),
    ]).then(([s, dl]) => {
      sov = s;
      dmaLeaders = dl;
      renderAll();
    }).catch(err => console.warn('sov data load failed', err));

    function renderAll() {
      // Build per-brand monthly counts and shares from sov.monthly
      const months = [...new Set(sov.monthly.map(r => r.month))].sort();
      const idx = new Map(months.map((m, i) => [m, i]));
      const counts = {};
      for (const b of TOXINS) counts[b] = new Array(months.length).fill(0);
      for (const r of sov.monthly) {
        if (!TOXINS.includes(r.brand) || !idx.has(r.month)) continue;
        counts[r.brand][idx.get(r.month)] = r.practice_count;
      }
      const totals = new Array(months.length).fill(0);
      for (let i = 0; i < months.length; i++)
        for (const b of TOXINS) totals[i] += counts[b][i];

      renderBars(months, counts, totals);
      renderLines(months, counts, totals);
      renderDMA();
    }

    function renderBars(months, counts, totals) {
      const W = barsEl.clientWidth, H = barsEl.clientHeight;
      const pad = { l: 56, r: 8, t: 8, b: 24 };
      const innerW = W - pad.l - pad.r;
      const innerH = H - pad.t - pad.b;
      const rowH = Math.max(8, Math.min(28, innerH / months.length - 3));

      let html = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
      for (let i = 0; i < months.length; i++) {
        const y = pad.t + i * (rowH + 3);
        const t = totals[i] || 1;
        let x = pad.l;
        for (const b of TOXINS) {
          const w = (counts[b][i] / t) * innerW;
          if (w > 0.5)
            html += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) +
                    '" height="' + rowH + '" fill="' + COLOR[b] + '" opacity="0.88"/>';
          x += w;
        }
        const [yr, mo] = months[i].split('-');
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo,10)-1];
        html += '<text x="' + (pad.l - 10) + '" y="' + (y + rowH/2 + 3) + '" fill="#5a6180" font-family="Inter,sans-serif" font-size="10" font-weight="700" text-anchor="end">' + monthName + " '" + yr.slice(2) + '</text>';
      }
      const mid = pad.l + innerW * 0.5;
      const lastY = pad.t + months.length * (rowH + 3);
      html += '<line x1="' + mid + '" x2="' + mid + '" y1="' + pad.t + '" y2="' + lastY + '" stroke="rgba(255,255,255,0.18)" stroke-dasharray="2 3"/>';
      html += '<text x="' + mid + '" y="' + (H - 6) + '" fill="#8892b0" font-family="Inter,sans-serif" font-size="10" text-anchor="middle">50% share</text>';
      html += '</svg>';
      barsEl.innerHTML = html;
    }

    function renderLines(months, counts, totals) {
      const W = linesEl.clientWidth, H = linesEl.clientHeight;
      const pad = { l: 8, r: 70, t: 12, b: 26 };
      const innerW = W - pad.l - pad.r;
      const innerH = H - pad.t - pad.b;
      const xs = i => pad.l + (months.length === 1 ? innerW / 2 : (i / (months.length - 1)) * innerW);
      const ys = v => pad.t + innerH - v * innerH;

      let html = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
      [0.25, 0.5, 0.75].forEach(p => {
        html += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + ys(p) + '" y2="' + ys(p) + '" stroke="#1c2032" stroke-dasharray="2 4"/>';
        html += '<text x="' + (W - pad.r + 6) + '" y="' + (ys(p) + 3) + '" fill="#5a6180" font-family="Inter,sans-serif" font-size="10">' + (p * 100) + '%</text>';
      });
      // Position end labels with vertical separation
      const endShares = TOXINS.map(b => ({
        b, s: counts[b][months.length-1] / (totals[months.length-1] || 1)
      })).sort((a,b) => b.s - a.s);
      const endY = {};
      let lastY = -100;
      for (const { b, s } of endShares) {
        let y = ys(s);
        if (y - lastY < 12) y = lastY + 12;
        endY[b] = y;
        lastY = y;
      }
      for (const b of TOXINS) {
        const pts = counts[b].map((v, i) => xs(i) + ',' + ys(v / (totals[i] || 1))).join(' ');
        html += '<polyline points="' + pts + '" fill="none" stroke="' + COLOR[b] + '" stroke-width="2" stroke-opacity="0.92"/>';
        const sNow = counts[b][months.length-1] / (totals[months.length-1] || 1);
        html += '<circle cx="' + xs(months.length-1) + '" cy="' + ys(sNow) + '" r="2.5" fill="' + COLOR[b] + '"/>';
        html += '<text x="' + (W - pad.r + 6) + '" y="' + (endY[b] + 3) + '" fill="' + COLOR[b] + '" font-family="Inter,sans-serif" font-size="10.5" font-weight="700">' + b + '</text>';
      }
      const step = Math.max(1, Math.floor(months.length / 6));
      for (let i = 0; i < months.length; i += step) {
        const [yr, mo] = months[i].split('-');
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo,10)-1];
        html += '<text x="' + xs(i) + '" y="' + (H - 8) + '" fill="#5a6180" font-family="Inter,sans-serif" font-size="10" font-weight="600" text-anchor="middle">' + monthName + " '" + yr.slice(2) + '</text>';
      }
      html += '</svg>';
      linesEl.innerHTML = html;
    }

    function renderDMA() {
      // dma-leader rows: { dma_code, dma_name, leader_brand, leader_share, location_count }
      const sorted = dmaLeaders.slice()
        .filter(d => d.location_count > 0)
        .sort((a, b) => b.location_count - a.location_count)
        .slice(0, 24);
      const max = Math.max(...sorted.map(d => d.location_count));
      let html = '';
      for (const d of sorted) {
        const wPct = Math.max(8, (d.location_count / max) * 100);
        const leader = d.leader_brand || '—';
        const c = COLOR[leader] || '#3a3f55';
        const leaderShare = Math.round((d.leader_share || 0) * 100);
        // City part of "Los Angeles, CA"
        const shortName = d.dma_name.split(',')[0];
        html += '<div class="sov-dma-cell">' +
                  '<div class="sov-dma-name" title="' + d.dma_name + '">' + shortName + '</div>' +
                  '<div class="sov-dma-bar" style="width:' + wPct + '%">' +
                    '<span style="background:' + c + ';width:' + (leaderShare || 100) + '%"></span>' +
                  '</div>' +
                  '<div class="sov-dma-leader" style="color:' + c + '">' + leader + (leaderShare ? ' ' + leaderShare + '%' : '') + '</div>' +
                  '<div class="sov-dma-total">' + d.location_count.toLocaleString() + '</div>' +
                '</div>';
      }
      dmaEl.innerHTML = html;
      if (meta) meta.textContent = sorted.length + ' DMAs · sized by practice count · share = leader brand mention rate among toxins';
    }

    let rt = null;
    window.addEventListener('resize', () => {
      if (rt) cancelAnimationFrame(rt);
      rt = requestAnimationFrame(() => { if (sov) renderAll(); });
    });
  }

  // Lazy-init: only construct the SoV panels when the figure is within
  // 200px of the viewport. V06 is in §04, well below the fold.
  function lazyInit() {
    const root = document.getElementById('sov-root');
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
