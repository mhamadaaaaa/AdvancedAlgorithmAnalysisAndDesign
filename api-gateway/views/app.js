/**
 * ==========================================================================
 * Frontend Dashboard — Algorithm Performance Visualization
 * ==========================================================================
 * Research : Analyzing the Complexity of Request Routing Algorithms
 *            in Microservices Architecture
 *
 * Data Sources:
 *   /api/metrics       — Real-time per-algorithm metrics from API Gateway
 *   /reports/report.json — Artillery aggregate stress-test report
 * ==========================================================================
 */

/* ──── Chart instances (for cleanup on re-render) ──── */
let charts = { algoExecution: null, latency: null, httpCodes: null, rps: null, bigO: null, workload: null, simLatency: null, simMemory: null, simSync: null };

/* ──── Chart.js global defaults ──── */
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.1)';
Chart.defaults.font.family = "'Inter','Cairo',sans-serif";
Chart.defaults.font.size = 13;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 20;

/* ──── Colour palette ──── */
const C = {
  blue: { bg: 'rgba(59,130,246,.2)', border: '#3b82f6' },
  cyan: { bg: 'rgba(6,182,212,.2)', border: '#06b6d4' },
  purple: { bg: 'rgba(139,92,246,.2)', border: '#8b5cf6' },
  emerald: { bg: 'rgba(16,185,129,.2)', border: '#10b981' },
  amber: { bg: 'rgba(245,158,11,.2)', border: '#f59e0b' },
  rose: { bg: 'rgba(244,63,94,.2)', border: '#f43f5e' }
};

/* ──── Auto-refresh state ──── */
let autoRefreshInterval = null;
let isAutoRefresh = false;

/* ================================================================
 * Main entry — fetch data from /api/metrics and render all charts
 * ================================================================ */
async function fetchAllData() {
  updateStatus('loading', 'جاري جلب البيانات...');
  try {
    const res = await fetch('/api/metrics');
    if (res.ok) {
      const metricsData = await res.json();
      updateStatus('success', 'تم تحميل البيانات بنجاح!');
      renderAlgoExecutionChart(metricsData);
      updateKPIs(metricsData);
      renderLatencyChart(metricsData);
      renderHttpCodesChart(metricsData);
      renderRpsChart(metricsData);
      renderWorkloadChart(metricsData);
    } else {
      updateStatus('waiting', 'في انتظار البيانات... قم بتشغيل اختبار الحمل المدمج أولاً.');
    }
    renderBigOChart();
  } catch (err) {
    console.error('Fetch error:', err);
    updateStatus('error', 'حدث خطأ أثناء جلب البيانات. تأكد من تشغيل الخدمات.');
    renderBigOChart();
  }
}

/* ================================================================
 * Status helpers
 * ================================================================ */
function updateStatus(state, msg) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (dot) dot.className = 'status-dot ' + state;
  if (text) text.textContent = msg;
}

/* ================================================================
 * KPI counters with eased animation
 * ================================================================ */
function updateKPIs(md) {
  const s = md.system, a = md.algorithms;
  animateCounter('kpiTotalRequests', s.totalRequests);
  animateCounter('kpiPoolSize', s.serverPoolSize);
  animateCounter('kpiUptime', s.uptime, 's');
  animateCounter('kpiMemory', s.memoryUsageMB || 0, 'MB', 2);
  animateCounter('kpiCpu', s.cpuUsagePercent || 0, '%', 1);
  animateCounter('kpiVirtualN', s.virtualPoolSize || s.serverPoolSize || 3);

  const avgs = Object.values(a).map(x => x.avgExecutionTimeMs).filter(v => v > 0);
  animateCounter('kpiAvgAlgoTime', avgs.length ? avgs.reduce((s, v) => s + v, 0) / avgs.length : 0, 'ms', 4);
}

function animateCounter(id, target, suffix, decimals) {
  suffix = suffix || '';
  decimals = decimals ?? 0;
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseFloat(el.textContent) || 0;
  const dur = 800;
  const t0 = performance.now();

  (function step(now) {
    const p = Math.min((now - t0) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);            // ease-out cubic
    el.textContent = (start + (target - start) * e).toFixed(decimals) + (suffix ? ' ' + suffix : '');
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

/* ================================================================
 * Chart 1 — Algorithm Execution-Time Comparison  (KEY CHART)
 * ================================================================ */
function renderAlgoExecutionChart(md) {
  const ctx = document.getElementById('algoExecutionChart');
  if (!ctx) return;
  if (charts.algoExecution) charts.algoExecution.destroy();

  const a = md.algorithms;
  const labels = [], avg = [], p95 = [], p99 = [];
  const bgArr = [C.emerald.bg, C.rose.bg, C.blue.bg];
  const bdArr = [C.emerald.border, C.rose.border, C.blue.border];

  if (a.roundRobin) {
    labels.push('Round Robin\nO(1)');
    avg.push(a.roundRobin.avgExecutionTimeMs);
    p95.push(a.roundRobin.p95ExecutionTimeMs);
    p99.push(a.roundRobin.p99ExecutionTimeMs);
  }
  if (a.weightedLeastConnections) {
    labels.push('WLC\nO(n)');
    avg.push(a.weightedLeastConnections.avgExecutionTimeMs);
    p95.push(a.weightedLeastConnections.p95ExecutionTimeMs);
    p99.push(a.weightedLeastConnections.p99ExecutionTimeMs);
  }
  if (a.hashBased) {
    labels.push('Hash-Based\nO(1)');
    avg.push(a.hashBased.avgExecutionTimeMs);
    p95.push(a.hashBased.p95ExecutionTimeMs);
    p99.push(a.hashBased.p99ExecutionTimeMs);
  }

  charts.algoExecution = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Average (ms)', data: avg, backgroundColor: bgArr, borderColor: bdArr, borderWidth: 2, borderRadius: 8 },
        { label: 'P95 (ms)', data: p95, backgroundColor: bgArr.map(c => c.replace('.2', '.35')), borderColor: bdArr, borderWidth: 2, borderRadius: 8 },
        { label: 'P99 (ms)', data: p99, backgroundColor: bgArr.map(c => c.replace('.2', '.5')), borderColor: bdArr, borderWidth: 2, borderRadius: 8 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Algorithm Routing Decision Time (ms)', color: '#f1f5f9', font: { size: 15, weight: '600' }, padding: { bottom: 20 } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Execution Time (ms)', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ================================================================
 * Chart 2 — End-to-end Latency (from live /api/metrics)
 * ================================================================ */
function renderLatencyChart(md) {
  const ctx = document.getElementById('latencyChart');
  if (!ctx) return;
  if (charts.latency) charts.latency.destroy();

  const rl = md.system && md.system.responseLatency;
  if (!rl || rl.samples === 0) {
    // Draw empty-state placeholder
    const parent = ctx.closest('.chart-card');
    const existing = parent && parent.querySelector('.chart-empty-msg');
    if (parent && !existing) {
      const msg = document.createElement('p');
      msg.className = 'chart-empty-msg';
      msg.textContent = '⏳ شغّل اختبار الحمل المدمج لملء هذا الرسم البياني';
      parent.appendChild(msg);
    }
    return;
  }

  charts.latency = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Min', 'Median', 'P95', 'P99', 'Max'],
      datasets: [{
        label: 'Response Time (ms)',
        data: [rl.minMs, rl.medianMs, rl.p95Ms, rl.p99Ms, rl.maxMs],
        backgroundColor: [C.emerald.bg, C.blue.bg, C.amber.bg, C.purple.bg, C.rose.bg],
        borderColor: [C.emerald.border, C.blue.border, C.amber.border, C.purple.border, C.rose.border],
        borderWidth: 2, borderRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'End-to-End Response Latency Distribution (' + rl.samples + ' samples)', color: '#f1f5f9', font: { size: 15, weight: '600' }, padding: { bottom: 20 } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Time (ms)', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ================================================================
 * Chart 3 — HTTP Status Codes (from live /api/metrics)
 * ================================================================ */
function renderHttpCodesChart(md) {
  const ctx = document.getElementById('httpCodesChart');
  if (!ctx) return;
  if (charts.httpCodes) charts.httpCodes.destroy();

  const hc = md.system && md.system.httpCodes;
  if (!hc || (hc.success + hc.error + hc.other) === 0) return;

  charts.httpCodes = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['نجاح (2xx)', 'أخطاء (5xx)', 'أخرى'],
      datasets: [{
        data: [hc.success, hc.error, hc.other],
        backgroundColor: [C.emerald.bg, C.rose.bg, C.amber.bg],
        borderColor: [C.emerald.border, C.rose.border, C.amber.border],
        borderWidth: 2, hoverOffset: 10
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { title: { display: true, text: 'HTTP Response Codes — Total: ' + (hc.success + hc.error + hc.other), color: '#f1f5f9', font: { size: 15, weight: '600' }, padding: { bottom: 20 } } }
    }
  });
}

/* ================================================================
 * Chart 4 — Throughput over time (from live /api/metrics RPS windows)
 * ================================================================ */
function renderRpsChart(md) {
  const ctx = document.getElementById('rpsChart');
  if (!ctx) return;
  if (charts.rps) charts.rps.destroy();

  const history = (md.system && md.system.rpsHistory) || [];
  if (history.length === 0) return;

  charts.rps = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.label),
      datasets: [{
        label: 'Requests/sec',
        data: history.map(h => h.rps),
        borderColor: C.cyan.border, backgroundColor: C.cyan.bg,
        fill: true, tension: .4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Throughput Over Time (req/s)', color: '#f1f5f9', font: { size: 15, weight: '600' }, padding: { bottom: 20 } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'RPS', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ================================================================
 * Built-in Load Generator — sends real requests, fills all charts
 * ================================================================ */
let isLoadTestRunning = false;

async function runBuiltInLoadTest() {
  if (isLoadTestRunning) return;
  isLoadTestRunning = true;

  const btn = document.getElementById('loadTestBtn');
  const progressBar = document.getElementById('loadProgressBar');
  const progressText = document.getElementById('loadProgressText');
  const progressWrap = document.getElementById('loadTestProgress');
  const totalRequests = parseInt(document.getElementById('loadTestCount').value, 10) || 100;
  const workloadSel = document.getElementById('loadWorkload')?.value || 'mixed';
  const virtualN = parseInt(document.getElementById('virtualPoolN')?.value, 10) || 1000;
  const CONCURRENCY = 8;

  // Hide all-algo panel if not in 'all' mode
  const allPanel = document.getElementById('allAlgoPanel');
  if (allPanel) allPanel.style.display = workloadSel === 'all' ? 'block' : 'none';

  await applyVirtualPool(virtualN);

  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الاختبار...'; }
  if (progressWrap) progressWrap.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';

  // ── "All" mode: run all 3 algorithms on all 3 workloads ─
  if (workloadSel === 'all') {
    if (progressText) progressText.textContent = '⚡ تشغيل المقارنة على الخوارزميات الثلاث (read · compute · mixed)…';
    await runAllAlgosComparison(['read', 'compute', 'mixed'], virtualN, totalRequests);
    isLoadTestRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = '🚀 تشغيل اختبار الحمل المدمج'; }
    if (progressText) progressText.textContent = '✅ اكتملت المقارنة! الخوارزميات الثلاث — read · compute · mixed';
    setTimeout(fetchAllData, 500);
    return;
  }

  // ── Normal single-workload mode ─────────────────────────────────
  const workload = workloadSel;
  if (progressText) progressText.textContent = '0 / ' + totalRequests + ' طلب (' + workload + ')';

  const endpoints = [
    '/route/rr?workload=' + workload + '&n=' + virtualN,
    '/route/wlc?workload=' + workload + '&n=' + virtualN,
    '/route/hash?workload=' + workload + '&n=' + virtualN,
    '/proxy?workload=' + workload + '&n=' + virtualN
  ];
  let completed = 0;

  const sendOne = async (ep) => {
    try { await fetch(ep); } catch (e) { /* ignore */ }
    completed++;
    const pct = Math.round((completed / totalRequests) * 100);
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressText) progressText.textContent = completed + ' / ' + totalRequests + ' طلب (' + pct + '%) — ' + workload;
  };

  const allEndpoints = Array.from({ length: totalRequests }, (_, i) => endpoints[i % endpoints.length]);

  for (let i = 0; i < allEndpoints.length; i += CONCURRENCY) {
    const batch = allEndpoints.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(ep => sendOne(ep)));
    await new Promise(r => setTimeout(r, 30));
  }

  isLoadTestRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '🚀 تشغيل اختبار الحمل المدمج'; }
  if (progressText) progressText.textContent = '✅ اكتمل! ' + totalRequests + ' طلب — ' + workload;

  setTimeout(fetchAllData, 500);
}

async function applyVirtualPool(nOverride) {
  const n = nOverride || parseInt(document.getElementById('virtualPoolN')?.value, 10) || 1000;
  try {
    await fetch('/api/settings/pool-size?n=' + n, { method: 'POST' });
  } catch (e) { /* ignore */ }
}

async function runBenchmark() {
  const n = parseInt(document.getElementById('virtualPoolN')?.value, 10) || 1000;
  const el = document.getElementById('benchmarkResult');
  if (el) el.textContent = '⏳ Running benchmark for n=' + n + '...';
  try {
    const res = await fetch('/api/benchmark?n=' + n + '&iterations=100');
    const data = await res.json();
    const lines = data.results.map(r =>
      r.algo + ' [' + r.timeComplexity + ']: avg=' + r.avgMs.toFixed(4) + 'ms, p95=' + r.p95Ms.toFixed(4) + 'ms'
    );
    if (el) el.textContent = 'Benchmark n=' + n + ' (physical=' + data.physicalNodes + '):\n' + lines.join('\n') + '\n→ ' + data.interpretation;
  } catch (e) {
    if (el) el.textContent = 'Benchmark failed — is the gateway running?';
  }
}

async function loadArtilleryReport() {
  const el = document.getElementById('artillerySummary');
  try {
    let res = await fetch('/reports/synthesis-report.json');
    if (!res.ok) res = await fetch('/reports/report.json');
    if (!res.ok) throw new Error('no report');
    const report = await res.json();
    const art = report.phase4?.artilleryStressTests || report.artilleryStressTests;
    if (!art) {
      if (el) el.innerHTML = '⚠️ لا يوجد تقرير Artillery بعد. شغّل: <code>npm run test:all</code>';
      return;
    }
    const parts = ['readHeavy', 'computeHeavy', 'mixed'].map(k => {
      const r = art[k];
      if (!r?.available) return k + ': (not run)';
      return k + ': p95=' + (r.latencyMs?.p95 ?? '?') + 'ms, RPS≈' + (r.throughputRps ?? '?');
    });
    if (el) el.innerHTML = '<strong>Artillery Summary:</strong> ' + parts.join(' · ');
  } catch (e) {
    if (el) el.innerHTML = '⚠️ شغّل Docker ثم <code>npm install && npm run test:all</code> لتوليد التقارير.';
  }
}

async function exportSynthesisReport() {
  try {
    const res = await fetch('/api/synthesis-report');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'synthesis-report-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('تعذّر تصدير التقرير — تأكد من تشغيل البوابة.');
  }
}

/* ================================================================
 * Load & display synthesis-report.json results in the KPI panel
 * ================================================================ */
async function loadStressReport() {
  const panel = document.getElementById('stressReportPanel');
  const kpisEl = document.getElementById('stressReportKpis');
  const tableEl = document.getElementById('stressReportTable');
  const metaEl = document.getElementById('stressReportMeta');

  if (!panel) return;

  // ── Priority 1: live results from "All Algorithms" run ──
  if (window._liveStressResults) {
    _renderLiveStressPanel(window._liveStressResults, panel, kpisEl, tableEl, metaEl);
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // ── Priority 2: try synthesis-report.json ──────────────────────
  let data = null;
  for (const url of ['/reports/synthesis-report.json', '/reports/report.json', '/api/synthesis-report']) {
    try {
      const res = await fetch(url + '?' + Date.now());
      if (res.ok) { data = await res.json(); break; }
    } catch(e) { /* try next */ }
  }

  if (!data || !data.scenarios) {
    kpisEl.innerHTML = '<div style="color:#f59e0b; padding:16px; font-size:.85rem;">&#x26A0;&#xFE0F; لا يوجد تقرير بعد. شغّل اختبار <b>All Algorithms</b> أولاً لتوليد نتائج فعلية.</div>';
    panel.style.display = 'block';
    return;
  }

  // Metadata
  if (metaEl && data.generatedAt) {
    metaEl.textContent = 'Generated: ' + new Date(data.generatedAt).toLocaleString();
  }

  // KPI cards from scenarios
  const sc = data.scenarios || [];
  const total = sc.reduce((s, r) => s + r.requests, 0);
  const avgByAlgo = (algo, field) => {
    const rows = sc.filter(s => s.algo === algo);
    if (!rows.length) return '—';
    return (rows.reduce((s, r) => s + r.latencyMs[field], 0) / rows.length).toFixed(1) + ' ms';
  };
  const avgRps = (algo) => {
    const rows = sc.filter(s => s.algo === algo);
    if (!rows.length) return '—';
    return (rows.reduce((s, r) => s + r.throughputRps, 0) / rows.length).toFixed(1) + ' rps';
  };

  const ALGO_COLOR = { RR: '#3b82f6', WLC: '#f59e0b', Hash: '#10b981' };
  const kpiDefs = [
    { label: 'إجمالي الطلبات', value: total.toLocaleString(), sub: sc.length + ' سيناريو', color: '#8b5cf6' },
    { label: 'RR — P95 Latency', value: avgByAlgo('RR', 'p95'), sub: 'O(1) · Avg RPS: ' + avgRps('RR'), color: ALGO_COLOR.RR },
    { label: 'WLC — P95 Latency', value: avgByAlgo('WLC', 'p95'), sub: 'O(n) · Avg RPS: ' + avgRps('WLC'), color: ALGO_COLOR.WLC },
    { label: 'Hash — P95 Latency', value: avgByAlgo('Hash', 'p95'), sub: 'O(1) · Avg RPS: ' + avgRps('Hash'), color: ALGO_COLOR.Hash },
  ];

  kpisEl.innerHTML = kpiDefs.map(k => `
    <div style="background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:16px 18px; border-top:3px solid ${k.color};">
      <div style="font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:#64748b; margin-bottom:6px;">${k.label}</div>
      <div style="font-size:24px; font-weight:800; font-family:'JetBrains Mono',monospace; color:${k.color};">${k.value}</div>
      <div style="font-size:11px; color:#64748b; margin-top:3px;">${k.sub}</div>
    </div>`).join('');

  // Detailed table
  const COMPLEXITY = { RR: '<span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">O(1)</span>', WLC: '<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">O(n)</span>', Hash: '<span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">O(1)</span>' };
  tableEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;font-family:'JetBrains Mono',monospace;">
      <thead>
        <tr style="background:rgba(0,0,0,.25);">
          <th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;border-bottom:1px solid rgba(255,255,255,.06);">Scenario</th>
          <th style="padding:9px 12px;text-align:center;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Complexity</th>
          <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Requests</th>
          <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">RPS</th>
          <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">P95 (ms)</th>
          <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">P99 (ms)</th>
          <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Err%</th>
        </tr>
      </thead>
      <tbody>
        ${sc.map(s => {
          const color = ALGO_COLOR[s.algo] || '#94a3b8';
          const errColor = parseFloat(s.errorRate) > 5 ? '#ef4444' : '#10b981';
          return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
            <td style="padding:9px 12px;text-align:left;"><span style="background:${color}22;color:${color};padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;">${s.algo}</span> ${s.workload}</td>
            <td style="padding:9px 12px;text-align:center;">${COMPLEXITY[s.algo] || ''}</td>
            <td style="padding:9px 12px;text-align:right;">${s.requests.toLocaleString()}</td>
            <td style="padding:9px 12px;text-align:right;">${s.throughputRps}</td>
            <td style="padding:9px 12px;text-align:right;color:#f1f5f9;">${s.latencyMs.p95}</td>
            <td style="padding:9px 12px;text-align:right;color:#f1f5f9;">${s.latencyMs.p99}</td>
            <td style="padding:9px 12px;text-align:right;color:${errColor};">${s.errorRate}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================================================================
 * Helper: render scenario table (shared between live + JSON modes)
 * ================================================================ */
function _renderScenarioTable(sc, tableEl, AC) {
  const CX = {
    RR:   '<span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">O(1)</span>',
    WLC:  '<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">O(n)</span>',
    Hash: '<span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700">O(1)</span>'
  };
  tableEl.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12.5px;font-family:'JetBrains Mono',monospace;">
    <thead><tr style="background:rgba(0,0,0,.25);">
      <th style="padding:9px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;border-bottom:1px solid rgba(255,255,255,.06);">Scenario</th>
      <th style="padding:9px 12px;text-align:center;color:#64748b;font-size:10px;font-weight:700;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Complexity</th>
      <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Requests</th>
      <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">RPS</th>
      <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Mean (ms)</th>
      <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">P95 (ms)</th>
      <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">P99 (ms)</th>
      <th style="padding:9px 12px;text-align:right;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">Err%</th>
      <th style="padding:9px 12px;text-align:center;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06);">${'\u062d\u0627\u0644\u0629'}</th>
    </tr></thead>
    <tbody>
      ${sc.map(s => {
        const c = AC[s.algo] || '#94a3b8';
        const ec = parseFloat(s.errorRate) > 5 ? '#ef4444' : '#10b981';
        const p95 = parseFloat(s.p95 ?? s.latencyMs?.p95 ?? 0);
        const p99 = parseFloat(s.p99 ?? s.latencyMs?.p99 ?? 0);
        const mean = parseFloat(s.mean ?? s.latencyMs?.mean ?? 0);
        const rps = s.rps ?? s.throughputRps ?? '\u2014';
        const req = s.requests;
        const btl = p95 > 500 || parseFloat(s.errorRate) > 10;
        return `<tr style="border-bottom:1px solid rgba(255,255,255,.04);${btl ? 'background:rgba(239,68,68,.08);' : ''}">
          <td style="padding:9px 12px;text-align:left;"><span style="background:${c}22;color:${c};padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;">${s.algo}</span> ${s.workload}</td>
          <td style="padding:9px 12px;text-align:center;">${CX[s.algo] || ''}</td>
          <td style="padding:9px 12px;text-align:right;">${req != null ? (typeof req === 'number' ? req.toLocaleString() : req) : '\u2014'}</td>
          <td style="padding:9px 12px;text-align:right;">${rps}</td>
          <td style="padding:9px 12px;text-align:right;color:#f1f5f9;">${mean.toFixed(2)}</td>
          <td style="padding:9px 12px;text-align:right;color:${p95>300?'#ef4444':'#f1f5f9'};font-weight:${p95>300?700:400};">${p95.toFixed(2)}</td>
          <td style="padding:9px 12px;text-align:right;color:#f1f5f9;">${p99.toFixed(2)}</td>
          <td style="padding:9px 12px;text-align:right;color:${ec};">${s.errorRate}%</td>
          <td style="padding:9px 12px;text-align:center;">${btl ? '\uD83D\uDD34 <span style="font-size:9px;color:#ef4444;font-weight:700;">Bottleneck</span>' : '\uD83D\uDFE2'}</td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
}

/* ================================================================
 * Helper: render stress panel from live computed results
 * ================================================================ */
function _renderLiveStressPanel(live, panel, kpisEl, tableEl, metaEl) {
  const { allResults, summaries, COLORS } = live;
  const AC = { RR: COLORS.RR, WLC: COLORS.WLC, Hash: COLORS.Hash };
  if (metaEl) metaEl.textContent = '\u26A1 \u0646\u062a\u0627\u0626\u062c \u0641\u0639\u0644\u064a\u0629 \u2014 ' + new Date().toLocaleString();
  kpisEl.innerHTML = ['RR','WLC','Hash'].map(a => {
    const s = summaries[a]; const c = AC[a];
    return `<div style="background:${s.hasBottleneck?'rgba(239,68,68,.12)':'rgba(255,255,255,.03)'};border:1px solid ${s.hasBottleneck?'#ef4444':'rgba(255,255,255,.08)'};border-radius:12px;padding:16px 18px;border-top:3px solid ${s.hasBottleneck?'#ef4444':c};">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:6px;">${a} \u2014 P95 Latency ${s.hasBottleneck?'\uD83D\uDD34':''}</div>
      <div style="font-size:24px;font-weight:800;font-family:'JetBrains Mono',monospace;color:${s.hasBottleneck?'#ef4444':c};">${s.avgP95} ms</div>
      <div style="font-size:11px;color:#64748b;margin-top:3px;">${a==='WLC'?'O(n)':'O(1)'} \u00b7 RPS: ${s.avgRps}${s.hasBottleneck?' \u00b7 <b style="color:#ef4444">\u0639\u0646\u0642 \u0632\u062c\u0627\u062c\u0629!</b>':''}</div>
    </div>`;
  }).join('');
  const sc = [];
  ['RR','WLC','Hash'].forEach(a => {
    allResults[a].forEach(r => sc.push({ algo:a, workload:r.workload, requests:null, rps:r.rps, mean:r.mean, p95:r.p95, p99:r.p99, errorRate:r.errorRate }));
  });
  _renderScenarioTable(sc, tableEl, AC);
}

/* Store live results for use by loadStressReport */
function renderAllAlgoStressPanel(allResults, summaries, workloads, COLORS) {
  window._liveStressResults = { allResults, summaries, workloads, COLORS };
}

/* ================================================================
 * All workload mode — run all 3 workloads on all 3 algorithms
 * and show a side-by-side comparison panel
 * ================================================================ */
async function runAllAlgosComparison(workloads, virtualN, totalRequests) {
  const panel = document.getElementById('allAlgoPanel');
  const grid  = document.getElementById('allAlgoGrid');
  if (!panel || !grid) return;

  panel.style.display = 'block';
  const COLORS = { RR: '#3b82f6', WLC: '#f59e0b', Hash: '#10b981' };
  const ROUTES = { RR: 'rr', WLC: 'wlc', Hash: 'hash' };
  const ALGOS = ['RR', 'WLC', 'Hash'];

  // ── Initial skeleton with per-algo progress bars ──────────────────
  grid.innerHTML = ALGOS.map(a => `
    <div id="allCard-${a}" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;transition:background .4s,border-color .4s;">
      <div style="font-size:12px;font-weight:700;color:${COLORS[a]};margin-bottom:10px;">
        ${a === 'RR' ? '🔄 Round Robin' : a === 'WLC' ? '⚖️ WLC' : '🔗 Hash'}
        <span style="font-size:9px;color:#64748b;font-weight:500;margin-right:6px;">${a === 'WLC' ? 'O(n)' : 'O(1)'}</span>
      </div>
      <div style="font-size:10px;color:#64748b;margin-bottom:6px;">التقدم الكلي</div>
      <div style="background:rgba(148,163,184,.12);border-radius:6px;overflow:hidden;height:6px;margin-bottom:4px;">
        <div id="prog-total-${a}" style="height:100%;width:0%;background:${COLORS[a]};transition:width .3s;"></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px;">
        ${workloads.map(w => `
          <div style="text-align:center;">
            <div style="font-size:9px;color:#64748b;margin-bottom:3px;">${w}</div>
            <div style="background:rgba(148,163,184,.1);border-radius:4px;overflow:hidden;height:4px;">
              <div id="prog-${a}-${w}" style="height:100%;width:0%;background:${COLORS[a]};transition:width .2s;"></div>
            </div>
          </div>`).join('')}
      </div>
      <div id="card-status-${a}" style="font-size:10px;color:#64748b;margin-top:8px;text-align:center;">⏳ في الانتظار…</div>
    </div>`).join('');

  // ── Test one algo on one workload ─────────────────────────────────
  const testAlgoWorkload = async (algoKey, workload, reqCount) => {
    const route = ROUTES[algoKey];
    const ep = `/route/${route}?workload=${workload}&n=${virtualN}`;
    const latencies = [];
    let success = 0, errors = 0;
    const BATCH = 8;
    const perBatch = Math.ceil(reqCount / BATCH);
    const progEl = document.getElementById(`prog-${algoKey}-${workload}`);
    for (let b = 0; b < BATCH; b++) {
      const batchPs = Array.from({ length: perBatch }, async () => {
        const t0 = performance.now();
        try { await fetch(ep); success++; } catch(e) { errors++; }
        latencies.push(performance.now() - t0);
      });
      await Promise.all(batchPs);
      if (progEl) progEl.style.width = Math.round(((b + 1) / BATCH) * 100) + '%';
      await new Promise(r => setTimeout(r, 20));
    }
    const elapsed = Math.max(0.001, (latencies.length > 0 ? latencies.reduce((s,v)=>s+v,0)/1000 : 1));
    const sorted = latencies.slice().sort((a, b) => a - b);
    const pct = p => sorted[Math.max(0, Math.floor(p / 100 * sorted.length) - 1)] || 0;
    return {
      workload,
      rps: (latencies.length / elapsed).toFixed(1),
      mean: sorted.length ? (sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(2) : '0.00',
      p95:  pct(95).toFixed(2),
      p99:  pct(99).toFixed(2),
      errorRate: ((errors / Math.max(1, success + errors)) * 100).toFixed(1),
    };
  };

  // ── Run each algo sequentially across all workloads ───────────────
  const allResults = {};
  const reqPerWorkload = Math.ceil(totalRequests / workloads.length);

  for (const algoKey of ALGOS) {
    const statusEl = document.getElementById(`card-status-${algoKey}`);
    const totalProg = document.getElementById(`prog-total-${algoKey}`);
    const card = document.getElementById(`allCard-${algoKey}`);
    if (statusEl) statusEl.textContent = '🔄 يعمل…';
    if (card) card.style.borderColor = COLORS[algoKey] + '88';

    const workloadResults = [];
    for (let wi = 0; wi < workloads.length; wi++) {
      const w = workloads[wi];
      if (statusEl) statusEl.textContent = `🔄 ${w}…`;
      const res = await testAlgoWorkload(algoKey, w, reqPerWorkload);
      workloadResults.push(res);
      if (totalProg) totalProg.style.width = Math.round(((wi + 1) / workloads.length) * 100) + '%';
    }
    allResults[algoKey] = workloadResults;
    if (statusEl) statusEl.textContent = '✅ اكتمل';
  }

  // ── Aggregate & detect bottlenecks ───────────────────────────────
  const aggregate = (algoKey) => {
    const rows = allResults[algoKey];
    const avgRps  = (rows.reduce((s,r) => s + parseFloat(r.rps),  0) / rows.length).toFixed(1);
    const avgMean = (rows.reduce((s,r) => s + parseFloat(r.mean), 0) / rows.length).toFixed(2);
    const avgP95  = (rows.reduce((s,r) => s + parseFloat(r.p95),  0) / rows.length).toFixed(2);
    const avgP99  = (rows.reduce((s,r) => s + parseFloat(r.p99),  0) / rows.length).toFixed(2);
    const avgErr  = (rows.reduce((s,r) => s + parseFloat(r.errorRate), 0) / rows.length).toFixed(1);
    const hasBottleneck = parseFloat(avgP95) > 500 || parseFloat(avgErr) > 10;
    return { avgRps, avgMean, avgP95, avgP99, avgErr, hasBottleneck, rows };
  };

  const summaries = {};
  ALGOS.forEach(a => { summaries[a] = aggregate(a); });

  // Find winner (lowest avgP95)
  const winner = ALGOS.reduce((best, a) =>
    parseFloat(summaries[a].avgP95) < parseFloat(summaries[best].avgP95) ? a : best, ALGOS[0]);

  // ── Render final cards ────────────────────────────────────────────
  ALGOS.forEach(algoKey => {
    const s = summaries[algoKey];
    const color = COLORS[algoKey];
    const isWinner = algoKey === winner;
    const card = document.getElementById('allCard-' + algoKey);
    if (!card) return;

    // Bottleneck → red background
    if (s.hasBottleneck) {
      card.style.background = 'rgba(239,68,68,0.12)';
      card.style.borderColor = '#ef4444';
      card.style.borderTopColor = '#ef4444';
    } else {
      card.style.background = isWinner ? 'rgba(16,185,129,0.07)' : 'rgba(255,255,255,.03)';
      card.style.borderColor = color + '88';
      card.style.borderTopColor = color;
    }
    card.style.borderTopWidth = '3px';

    const bottleneckHtml = s.hasBottleneck
      ? `<div style="grid-column:1/-1;background:rgba(239,68,68,.2);border:1px solid #ef4444;border-radius:6px;padding:5px 8px;font-size:10px;color:#ef4444;font-weight:700;">⚠️ عنق زجاجة مرصود — P95: ${s.avgP95}ms · Error: ${s.avgErr}%</div>`
      : '';

    const perWorkloadRows = s.rows.map(r => `
      <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;
                  background:rgba(255,255,255,.03);border-radius:6px;padding:4px 8px;margin-top:3px;font-size:10px;">
        <span style="color:#94a3b8;font-weight:600;">${r.workload}</span>
        <span style="color:#e2e8f0;font-family:'JetBrains Mono',monospace;">RPS: <b style="color:${color};">${r.rps}</b>  P95: <b>${r.p95}ms</b>  Err: <b style="color:${parseFloat(r.errorRate)>5?'#ef4444':'#10b981'}">${r.errorRate}%</b></span>
      </div>`).join('');

    card.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:${s.hasBottleneck ? '#ef4444' : color};margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span>${algoKey === 'RR' ? '🔄 Round Robin' : algoKey === 'WLC' ? '⚖️ WLC' : '🔗 Hash'}
          <span style="font-size:9px;color:#64748b;font-weight:500;margin-right:4px;">${algoKey === 'WLC' ? 'O(n)' : 'O(1)'}</span>
        </span>
        <span>${isWinner ? '🏆' : ''} ${s.hasBottleneck ? '🔴' : ''}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;text-align:left;">
        ${bottleneckHtml}
        <div style="font-size:10px;color:#64748b;">RPS (متوسط)</div>
        <div style="font-size:13px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${color};">${s.avgRps}</div>
        <div style="font-size:10px;color:#64748b;">Mean (ms)</div>
        <div style="font-size:12px;font-family:'JetBrains Mono',monospace;color:#e2e8f0;">${s.avgMean}</div>
        <div style="font-size:10px;color:#64748b;">P95 (ms)</div>
        <div style="font-size:12px;font-family:'JetBrains Mono',monospace;color:${parseFloat(s.avgP95)>300?'#ef4444':'#f1f5f9'};">${s.avgP95}</div>
        <div style="font-size:10px;color:#64748b;">P99 (ms)</div>
        <div style="font-size:12px;font-family:'JetBrains Mono',monospace;color:#e2e8f0;">${s.avgP99}</div>
        <div style="font-size:10px;color:#64748b;">Error%</div>
        <div style="font-size:12px;font-family:'JetBrains Mono',monospace;color:${parseFloat(s.avgErr)>5?'#ef4444':'#10b981'};">${s.avgErr}%</div>
        ${perWorkloadRows}
      </div>`;
  });

  // ── Push computed results into the stress report panel ───────────
  renderAllAlgoStressPanel(allResults, summaries, workloads, COLORS);
}

function renderWorkloadChart(md) {
  const ctx = document.getElementById('workloadChart');
  if (!ctx) return;
  if (charts.workload) charts.workload.destroy();

  const wb = md.system?.workloadBreakdown || {};
  const labels = ['Read-heavy', 'Compute-intensive', 'Mixed'];
  const keys = ['read', 'compute', 'mixed'];
  const medians = keys.map(k => wb[k]?.medianMs || 0);
  const p95s = keys.map(k => wb[k]?.p95Ms || 0);
  const counts = keys.map(k => wb[k]?.count || 0);

  charts.workload = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map((l, i) => l + ' (' + counts[i] + ')'),
      datasets: [
        { label: 'Median (ms)', data: medians, backgroundColor: C.blue.bg, borderColor: C.blue.border, borderWidth: 2, borderRadius: 6 },
        { label: 'P95 (ms)', data: p95s, backgroundColor: C.amber.bg, borderColor: C.amber.border, borderWidth: 2, borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Latency by Workload Type', color: '#f1f5f9' } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'ms', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ================================================================
 * Chart 5 — Theoretical Big-O Complexity Curves
 * ================================================================ */
function renderBigOChart() {
  const ctx = document.getElementById('bigOChart');
  if (!ctx) return;
  if (charts.bigO) charts.bigO.destroy();

  const ns = [100, 1000, 5000, 10000, 25000, 50000, 100000, 200000];
  const labels = ns.map(n => n >= 1000 ? (n / 1000) + 'K' : String(n));

  charts.bigO = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'O(1) — Round Robin / Hash-Based', data: ns.map(() => 1),
          borderColor: C.emerald.border, backgroundColor: C.emerald.bg, fill: false,
          borderWidth: 3, pointRadius: 4, tension: 0
        },
        {
          label: 'O(log n) — (reference)', data: ns.map(n => Math.log2(n) / Math.log2(100)),
          borderColor: C.amber.border, backgroundColor: C.amber.bg, fill: false,
          borderWidth: 2, borderDash: [8, 4], pointRadius: 3, tension: .3
        },
        {
          label: 'O(n) — Weighted Least Connections', data: ns.map(n => n / 100),
          borderColor: C.rose.border, backgroundColor: C.rose.bg, fill: false,
          borderWidth: 3, pointRadius: 4, tension: .3
        },
        {
          label: 'O(n log n) — (reference)', data: ns.map(n => (n * Math.log2(n)) / (100 * Math.log2(100))),
          borderColor: C.purple.border, backgroundColor: C.purple.bg, fill: false,
          borderWidth: 2, borderDash: [8, 4], pointRadius: 3, tension: .3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Theoretical Time Complexity Growth (Big-O)', color: '#f1f5f9', font: { size: 15, weight: '600' }, padding: { bottom: 20 } },
        tooltip: { callbacks: { label: ctx2 => { const n = ns[ctx2.dataIndex]; return `${ctx2.dataset.label}: f(${n}) = ${ctx2.parsed.y.toFixed(2)}`; } } }
      },
      scales: {
        y: { type: 'logarithmic', title: { display: true, text: 'Relative Time Units (log scale)', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { title: { display: true, text: 'Server Pool Size (n)', color: '#94a3b8' }, grid: { display: false } }
      }
    }
  });
}

/* ================================================================
 * Auto-refresh toggle
 * ================================================================ */
function toggleAutoRefresh() {
  isAutoRefresh = !isAutoRefresh;
  const btn = document.getElementById('autoRefreshBtn');
  const ind = document.getElementById('refreshIndicator');

  if (isAutoRefresh) {
    autoRefreshInterval = setInterval(fetchAllData, 5000);
    if (btn) btn.textContent = '⏸ إيقاف التحديث التلقائي';
    if (ind) ind.style.display = 'inline-flex';
  } else {
    clearInterval(autoRefreshInterval);
    if (btn) btn.textContent = '▶ تشغيل التحديث التلقائي';
    if (ind) ind.style.display = 'none';
  }
}

/* ================================================================
 * Scroll animation (IntersectionObserver)
 * ================================================================ */
function initScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.animate-on-scroll').forEach(el => obs.observe(el));
}

/* ================================================================
 * Navbar scroll effect
 * ================================================================ */
function initNavbar() {
  const nav = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 50);
  });

  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const t = document.getElementById(link.getAttribute('href').substring(1));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ================================================================
 * Init
 * ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initScrollAnimations();
  fetchAllData();
  runSimulation();
});

/* ================================================================
 * Simulation Dashboard — Interactive Modeling & Calculations
 * ================================================================ */
function updateSliderVal(sliderId, valId, suffix) {
  suffix = suffix || '';
  const val = document.getElementById(sliderId).value;
  let formatted = val;
  if (sliderId === 'sliderN' || sliderId === 'sliderM') {
    formatted = parseInt(val, 10).toLocaleString();
  }
  const el = document.getElementById(valId);
  if (el) el.textContent = formatted + suffix;
}

function runLocalSimulation(n, k, syncInterval, m, hopLatency, algo) {
  const baseBackendMs = 10.0;
  let algoMs = 0.0;
  if (algo === 'rr') algoMs = 0.005;
  else if (algo === 'hash') algoMs = 0.008;
  else algoMs = 0.0001 * n; // WLC linear scan

  const serviceCapacity = 1000.0 / Math.max(0.01, algoMs);
  const maxGatewayRps = 15000.0;
  const mu = Math.min(serviceCapacity, maxGatewayRps);

  const lambda = m;
  const rho = Math.min(0.999, lambda / mu);

  let centralizedQueueMs = 0.0;
  if (rho < 0.95) {
    centralizedQueueMs = rho / ((mu / 1000.0) * (1.0 - rho));
  } else {
    centralizedQueueMs = 100.0 + (rho - 0.95) * 2000.0;
  }
  centralizedQueueMs = Math.min(3000.0, Math.max(0.0, centralizedQueueMs));

  const centHop = hopLatency;
  const centAlgo = algoMs;
  const centQueue = centralizedQueueMs;
  const centBackend = baseBackendMs;
  const centTotal = centHop + centAlgo + centQueue + centBackend;

  const serverRecordBytes = 100;
  const baseGatewayBytes = 25 * 1024 * 1024;
  const centMemoryMB = (baseGatewayBytes + (n * serverRecordBytes)) / (1024 * 1024);

  const sidecarLambda = m / k;
  const sidecarMu = mu;
  const sidecarRho = Math.min(0.999, sidecarLambda / sidecarMu);

  let sidecarQueueMs = 0.0;
  if (sidecarRho < 0.95) {
    sidecarQueueMs = sidecarRho / ((sidecarMu / 1000.0) * (1.0 - sidecarRho));
  } else {
    sidecarQueueMs = 10.0 + (sidecarRho - 0.95) * 50.0;
  }
  sidecarQueueMs = Math.min(500.0, Math.max(0.0, sidecarQueueMs));

  let herdDelayMs = 0.0;
  if (algo === 'wlc' && syncInterval > 0) {
    const stalenessFactor = syncInterval / 1000.0;
    herdDelayMs = 0.15 * m * Math.pow(stalenessFactor, 2.0) * (1.0 + (100.0 / n));
  }
  herdDelayMs = Math.min(1000.0, herdDelayMs);

  const decHop = 0.0;
  const decAlgo = algoMs;
  const decQueue = sidecarQueueMs;
  const decHerd = herdDelayMs;
  const decBackend = baseBackendMs;
  const decTotal = decHop + decAlgo + decQueue + decHerd + decBackend;

  const baseSidecarBytes = 15 * 1024 * 1024;
  const totalDecMemoryMB = (k * (baseSidecarBytes + (n * serverRecordBytes))) / (1024 * 1024);

  const gossipSyncRateSec = syncInterval > 0 ? (k * (k - 1)) / (syncInterval / 1000.0) : 0;
  const syncBandwidthKbps = (gossipSyncRateSec * 64 * 8) / 1024;

  let bottleneckCent = "None";
  if (centQueue > 15) bottleneckCent = "Gateway Queue High (m)";
  else if (centAlgo > 8) bottleneckCent = "CPU Exhaustion (High n)";

  let bottleneckDec = "None";
  if (decHerd > 15) bottleneckDec = "Data Staleness (High T)";
  else if (gossipSyncRateSec > 800) bottleneckDec = "Gossip Traffic Storm";

  return {
    parameters: { n, k, syncInterval, m, hopLatency, algo },
    centralized: {
      latency: { networkHopMs: centHop, routingAlgoMs: centAlgo, queuingDelayMs: centQueue, backendProcessMs: centBackend, totalMs: centTotal },
      space: { memoryMB: centMemoryMB, complexity: 'O(n)' },
      bottleneck: bottleneckCent
    },
    decentralized: {
      latency: { networkHopMs: decHop, routingAlgoMs: decAlgo, queuingDelayMs: decQueue, staleHerdDelayMs: decHerd, backendProcessMs: decBackend, totalMs: decTotal },
      space: { memoryMB: totalDecMemoryMB, complexity: 'O(k * n)' },
      syncOverhead: { messagesPerSec: gossipSyncRateSec, bandwidthKbps: syncBandwidthKbps },
      bottleneck: bottleneckDec
    }
  };
}

async function runSimulation() {
  const algoEl = document.getElementById('simAlgoSelect');
  const nEl = document.getElementById('sliderN');
  const kEl = document.getElementById('sliderK');
  const tEl = document.getElementById('sliderT');
  const mEl = document.getElementById('sliderM');
  const hopEl = document.getElementById('sliderHop');

  if (!algoEl || !nEl || !kEl || !tEl || !mEl || !hopEl) return;

  const algo = algoEl.value;
  const n = parseInt(nEl.value, 10);
  const k = parseInt(kEl.value, 10);
  const sync = parseInt(tEl.value, 10);
  const m = parseInt(mEl.value, 10);
  const hop = parseFloat(hopEl.value);

  // High-fidelity local simulation for instant responsiveness
  const localSimResult = runLocalSimulation(n, k, sync, m, hop, algo);
  updateSimUI(localSimResult);

  // Attempt to load from gateway backend if running inside docker network
  try {
    const res = await fetch(`/api/simulation?n=${n}&k=${k}&sync=${sync}&m=${m}&hop=${hop}&algo=${algo}`);
    if (res.ok) {
      const serverSimResult = await res.json();
      updateSimUI(serverSimResult);
    }
  } catch (err) {
    console.warn('Gateway simulator API unavailable, using local high-fidelity fallback:', err);
  }
}

function updateSimUI(data) {
  const c = data.centralized;
  const d = data.decentralized;

  // 1. Centralized Telemetry
  document.getElementById('simCentTotalMs').textContent = c.latency.totalMs.toFixed(2) + ' ms';
  document.getElementById('simCentHopMs').textContent = c.latency.networkHopMs.toFixed(2) + ' ms';
  document.getElementById('simCentAlgoMs').textContent = c.latency.routingAlgoMs.toFixed(6) + ' ms';
  document.getElementById('simCentQueueMs').textContent = c.latency.queuingDelayMs.toFixed(2) + ' ms';
  document.getElementById('simCentBackendMs').textContent = c.latency.backendProcessMs.toFixed(2) + ' ms';
  document.getElementById('simCentMemoryMB').textContent = c.space.memoryMB.toFixed(2) + ' MB';

  const centBtn = document.getElementById('simCentBottleneck');
  if (centBtn) {
    centBtn.textContent = c.bottleneck === 'None' ? '✅ ممتاز (مستقر)' : c.bottleneck;
    centBtn.className = 'val badge ' + (c.bottleneck === 'None' ? 'success' : 'danger');
  }

  // 2. Decentralized Telemetry
  document.getElementById('simDecTotalMs').textContent = d.latency.totalMs.toFixed(2) + ' ms';
  document.getElementById('simDecAlgoMs').textContent = d.latency.routingAlgoMs.toFixed(6) + ' ms';
  document.getElementById('simDecQueueMs').textContent = d.latency.queuingDelayMs.toFixed(2) + ' ms';
  document.getElementById('simDecHerdMs').textContent = d.latency.staleHerdDelayMs.toFixed(2) + ' ms';
  document.getElementById('simDecMemoryMB').textContent = d.space.memoryMB.toFixed(2) + ' MB';
  document.getElementById('simDecSyncOverhead').textContent =
    d.syncOverhead.messagesPerSec.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' msgs/s (' +
    d.syncOverhead.bandwidthKbps.toFixed(2) + ' Kbps)';

  const decBtn = document.getElementById('simDecBottleneck');
  if (decBtn) {
    decBtn.textContent = d.bottleneck === 'None' ? '✅ ممتاز (مستقر)' : d.bottleneck;
    decBtn.className = 'val badge ' + (d.bottleneck === 'None' ? 'success' : 'danger');
  }

  // 3. Render charts
  renderSimLatencyChart(data);
  renderSimMemoryChart(data);
  renderSimSyncChart(data);
}

function renderSimLatencyChart(data) {
  const ctx = document.getElementById('simLatencyChart');
  if (!ctx) return;
  if (charts.simLatency) charts.simLatency.destroy();

  const c = data.centralized.latency;
  const d = data.decentralized.latency;

  charts.simLatency = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['بوابة API المركزية', 'الشبكة الخدمية Mesh'],
      datasets: [
        { label: 'الخوارزمية (Routing Algo)', data: [c.routingAlgoMs, d.routingAlgoMs], backgroundColor: C.emerald.bg, borderColor: C.emerald.border, borderWidth: 2, borderRadius: 6 },
        { label: 'القفزة الإضافية (Network Hop)', data: [c.networkHopMs, d.networkHopMs], backgroundColor: C.cyan.bg, borderColor: C.cyan.border, borderWidth: 2, borderRadius: 6 },
        { label: 'طابور CPU (Queue Delay)', data: [c.queuingDelayMs, d.queuingDelayMs], backgroundColor: C.amber.bg, borderColor: C.amber.border, borderWidth: 2, borderRadius: 6 },
        { label: 'جمود المزامنة (Herd Effect)', data: [0.0, d.staleHerdDelayMs], backgroundColor: C.rose.bg, borderColor: C.rose.border, borderWidth: 2, borderRadius: 6 },
        { label: 'الخادم الخلفي (Backend Process)', data: [c.backendProcessMs, d.backendProcessMs], backgroundColor: C.blue.bg, borderColor: C.blue.border, borderWidth: 2, borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        title: { display: false }
      },
      scales: {
        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Latency (ms)', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { stacked: true, grid: { display: false } }
      }
    }
  });
}

// Memory footprint / Space Complexity chart
function renderSimMemoryChart(data) {
  const ctx = document.getElementById('simMemoryChart');
  if (!ctx) return;
  if (charts.simMemory) charts.simMemory.destroy();

  const c = data.centralized.space.memoryMB;
  const d = data.decentralized.space.memoryMB;

  charts.simMemory = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['بوابة API المركزية O(n)', 'الشبكة الخدمية O(k*n)'],
      datasets: [{
        label: 'حجم استهلاك الذاكرة الكلي (MB)',
        data: [c, d],
        backgroundColor: [C.blue.bg, C.purple.bg],
        borderColor: [C.blue.border, C.purple.border],
        borderWidth: 2, borderRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Total RAM (MB)', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// Gossip network replication overhead chart
function renderSimSyncChart(data) {
  const ctx = document.getElementById('simSyncChart');
  if (!ctx) return;
  if (charts.simSync) charts.simSync.destroy();

  const syncInterval = data.parameters.syncInterval;
  const ks = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
  const gossipRates = ks.map(kVal => syncInterval > 0 ? (kVal * (kVal - 1)) / (syncInterval / 1000.0) : 0);

  charts.simSync = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ks.map(kVal => kVal + ' Sidecars'),
      datasets: [
        {
          label: 'رسائل المزامنة Gossip بالثانية (msgs/s)',
          data: gossipRates,
          borderColor: C.rose.border, backgroundColor: C.rose.bg,
          fill: true, tension: .4, pointRadius: 4, borderWidth: 2
        },
        {
          label: 'نقطة العمل الحالية للشبكة الخدمية',
          data: ks.map(kVal => kVal === data.parameters.k ? data.decentralized.syncOverhead.messagesPerSec : null),
          borderColor: C.cyan.border, backgroundColor: C.cyan.border,
          pointRadius: 8, pointHoverRadius: 10, showLine: false
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Sync Messages / Sec', color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,.06)' } },
        x: { grid: { display: false } }
      }
    }
  });
}
