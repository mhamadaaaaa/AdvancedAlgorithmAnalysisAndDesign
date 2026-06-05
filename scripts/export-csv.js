/**
 * export-csv.js
 * ─────────────────────────────────────────────────────────────────
 * Reads synthesis-report.json and exports multiple CSV files
 * ready for Excel / academic analysis.
 *
 * Usage:  node scripts/export-csv.js
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const SYNTH_PATH  = path.join(REPORTS_DIR, 'synthesis-report.json');

function toCSV(headers, rows) {
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

function main() {
  if (!fs.existsSync(SYNTH_PATH)) {
    console.error(`\x1b[31m[export-csv] ERROR: ${SYNTH_PATH} not found.\x1b[0m`);
    console.error('Run "node scripts/stressTest.js" first to generate the report.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(SYNTH_PATH, 'utf8'));
  const scenarios = data.scenarios || [];
  const benchmark = data.complexity?.benchmark || [];

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // ── 1. Latency Comparison ──────────────────────────────────────
  const latRows = scenarios.map(s => ({
    Algorithm:      s.algo,
    Workload:       s.workload,
    'Min (ms)':     s.latencyMs.min,
    'Mean (ms)':    s.latencyMs.mean,
    'Median (ms)':  s.latencyMs.median,
    'P75 (ms)':     s.latencyMs.p75,
    'P95 (ms)':     s.latencyMs.p95,
    'P99 (ms)':     s.latencyMs.p99,
    'Max (ms)':     s.latencyMs.max,
  }));
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'latency-comparison.csv'),
    toCSV(Object.keys(latRows[0] || {}), latRows)
  );
  console.log('\x1b[32m✓\x1b[0m Written: reports/latency-comparison.csv');

  // ── 2. Throughput & Error Rate ─────────────────────────────────
  const tpRows = scenarios.map(s => ({
    Algorithm:          s.algo,
    Workload:           s.workload,
    'Total Requests':   s.requests,
    'Throughput (rps)': s.throughputRps,
    'Error Rate (%)':   s.errorRate,
    'Complexity':       s.algo === 'WLC' ? 'O(n)' : 'O(1)',
  }));
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'throughput-comparison.csv'),
    toCSV(Object.keys(tpRows[0] || {}), tpRows)
  );
  console.log('\x1b[32m✓\x1b[0m Written: reports/throughput-comparison.csv');

  // ── 3. Benchmark: O(1) vs O(n) across n values ────────────────
  if (benchmark.length > 0) {
    const bRows = benchmark.map(b => ({
      'Pool Size (n)':    b.n,
      'Algorithm':        b.algo,
      'Avg Time (ms)':    b.avgMs,
      'Complexity Class': b.complexity,
    }));
    fs.writeFileSync(
      path.join(REPORTS_DIR, 'benchmark-complexity.csv'),
      toCSV(Object.keys(bRows[0] || {}), bRows)
    );
    console.log('\x1b[32m✓\x1b[0m Written: reports/benchmark-complexity.csv');
  }

  // ── 4. Algorithm Summary (aggregated per algo across workloads) ─
  const algos = [...new Set(scenarios.map(s => s.algo))];
  const summaryRows = algos.map(algo => {
    const rows = scenarios.filter(s => s.algo === algo);
    const avg  = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : 'N/A';
    return {
      Algorithm:              algo,
      'Complexity':           algo === 'WLC' ? 'O(n)' : 'O(1)',
      'Avg Throughput (rps)': avg(rows.map(r => r.throughputRps)),
      'Avg Latency Mean (ms)':avg(rows.map(r => r.latencyMs.mean)),
      'Avg Latency P95 (ms)': avg(rows.map(r => r.latencyMs.p95)),
      'Avg Error Rate (%)':   avg(rows.map(r => r.errorRate)),
      'Total Requests':       rows.reduce((s, r) => s + r.requests, 0),
    };
  });
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'algorithm-summary.csv'),
    toCSV(Object.keys(summaryRows[0] || {}), summaryRows)
  );
  console.log('\x1b[32m✓\x1b[0m Written: reports/algorithm-summary.csv');

  // ── 5. Workload Summary ────────────────────────────────────────
  const workloads = [...new Set(scenarios.map(s => s.workload))];
  const wlRows = workloads.map(wl => {
    const rows = scenarios.filter(s => s.workload === wl);
    const byAlgo = {};
    for (const r of rows) {
      byAlgo[r.algo] = { rps: r.throughputRps, p95: r.latencyMs.p95 };
    }
    return {
      Workload:             wl,
      'RR Throughput (rps)':   byAlgo['RR']?.rps   || 'N/A',
      'RR P95 (ms)':           byAlgo['RR']?.p95   || 'N/A',
      'WLC Throughput (rps)':  byAlgo['WLC']?.rps  || 'N/A',
      'WLC P95 (ms)':          byAlgo['WLC']?.p95  || 'N/A',
      'Hash Throughput (rps)': byAlgo['Hash']?.rps || 'N/A',
      'Hash P95 (ms)':         byAlgo['Hash']?.p95 || 'N/A',
    };
  });
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'workload-summary.csv'),
    toCSV(Object.keys(wlRows[0] || {}), wlRows)
  );
  console.log('\x1b[32m✓\x1b[0m Written: reports/workload-summary.csv');

  console.log('\n\x1b[1m\x1b[32m✅ All CSV files exported to ./reports/\x1b[0m');
  console.log('   Open reports/dashboard.html in your browser for visualizations.\n');
}

main();
