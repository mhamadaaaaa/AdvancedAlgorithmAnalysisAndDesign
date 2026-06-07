/**
 * stressTest.js
 * ─────────────────────────────────────────────────────────────────
 * Phase 3: Data Collection & Stress Testing
 * Runs api-gateway + 3 microservices locally (no Docker needed),
 * fires Autocannon load tests across all algorithm/workload combos,
 * and writes results to ./reports/ as JSON + CSV.
 *
 * Usage:  node scripts/stressTest.js
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const http      = require('http');

// ── Paths ──────────────────────────────────────────────────────────
const ROOT         = path.join(__dirname, '..');
const REPORTS_DIR  = path.join(ROOT, 'reports');
const GW_DIR       = path.join(ROOT, 'api-gateway');
const SVC_DIR      = path.join(ROOT, 'microservice');

// ── Config ─────────────────────────────────────────────────────────
const GW_PORT      = 9090;
const SVC_PORTS    = [3001, 3002, 3003];
const GATEWAY_URL  = `http://localhost:${GW_PORT}`;

// Autocannon settings (tuned for a laptop — raise for dedicated server)
const DURATION_SEC  = 15;   // seconds per scenario
const CONNECTIONS   = 20;   // concurrent connections
const WARM_UP_SEC   = 5;    // warm-up before recording

const SCENARIOS = [
  { label: 'Round-Robin   | read',    url: '/route/rr?workload=read',     algo: 'RR',   workload: 'read'    },
  { label: 'Round-Robin   | compute', url: '/route/rr?workload=compute',  algo: 'RR',   workload: 'compute' },
  { label: 'Round-Robin   | mixed',   url: '/route/rr?workload=mixed',    algo: 'RR',   workload: 'mixed'   },
  { label: 'WLC           | read',    url: '/route/wlc?workload=read',    algo: 'WLC',  workload: 'read'    },
  { label: 'WLC           | compute', url: '/route/wlc?workload=compute', algo: 'WLC',  workload: 'compute' },
  { label: 'WLC           | mixed',   url: '/route/wlc?workload=mixed',   algo: 'WLC',  workload: 'mixed'   },
  { label: 'Hash-Based    | read',    url: '/route/hash?workload=read',   algo: 'Hash', workload: 'read'    },
  { label: 'Hash-Based    | compute', url: '/route/hash?workload=compute',algo: 'Hash', workload: 'compute' },
  { label: 'Hash-Based    | mixed',   url: '/route/hash?workload=mixed',  algo: 'Hash', workload: 'mixed'   },
];

// ── Helpers ────────────────────────────────────────────────────────
const log   = (msg) => console.log(`\x1b[36m[stress]\x1b[0m ${msg}`);
const ok    = (msg) => console.log(`\x1b[32m[  ok  ]\x1b[0m ${msg}`);
const warn  = (msg) => console.log(`\x1b[33m[ warn ]\x1b[0m ${msg}`);
const error = (msg) => console.error(`\x1b[31m[ err  ]\x1b[0m ${msg}`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function spawnProcess(label, cmd, args, cwd, env = {}) {
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  proc.stdout.on('data', d => process.stdout.write(`\x1b[90m[${label}] ${d}\x1b[0m`));
  proc.stderr.on('data', d => process.stdout.write(`\x1b[90m[${label}] ${d}\x1b[0m`));
  return proc;
}

function waitForPort(port, retries = 30, delayMs = 1000, hostname = 'localhost') {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const req = http.get(`http://${hostname}:${port}/`, (res) => {
        resolve();
      });
      req.on('error', () => {
        tries++;
        if (tries >= retries) return reject(new Error(`${hostname}:${port} not ready after ${retries} tries`));
        setTimeout(attempt, delayMs);
      });
      req.setTimeout(1500, () => { req.destroy(); });
    };
    attempt();
  });
}

// ── Autocannon (inline, no npm install needed) ─────────────────────
function runAutocannon(url, durationSec, connections) {
  return new Promise((resolve, reject) => {
    const results = [];
    let totalLatencies = [];
    let statusCodes = {};
    let errors = 0;
    let requests = 0;
    const startTime = Date.now();

    // Use http to bombard the endpoint and measure timings
    let active = 0;
    let done = false;

    const shoot = () => {
      if (done) return;
      active++;
      const t0 = process.hrtime.bigint();
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          const latMs = Number(process.hrtime.bigint() - t0) / 1e6;
          totalLatencies.push(latMs);
          requests++;
          statusCodes[res.statusCode] = (statusCodes[res.statusCode] || 0) + 1;
          active--;
          if (!done) shoot();
        });
      });
      // Bug fix: req.destroy() triggers 'error' event — use a flag to prevent double-counting
      let finished = false;
      req.on('error', () => {
        if (finished) return;
        finished = true;
        errors++;
        active--;
        if (!done) shoot();
      });
      req.setTimeout(5000, () => {
        if (finished) return;
        finished = true;
        errors++;
        active--;
        req.destroy();
        if (!done) shoot();
      });
    };

    // Fire initial batch
    for (let i = 0; i < connections; i++) shoot();

    setTimeout(() => {
      done = true;
      const elapsed = (Date.now() - startTime) / 1000;
      const sorted = totalLatencies.slice().sort((a, b) => a - b);
      const n = sorted.length;
      const pct = (p) => n ? sorted[Math.floor(p * n / 100)] || 0 : 0;
      const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : 0;

      resolve({
        requests,
        errors,
        throughputRps: (requests / elapsed).toFixed(2),
        durationSec: elapsed.toFixed(1),
        latencyMs: {
          min:    n ? sorted[0].toFixed(3) : 0,
          max:    n ? sorted[n-1].toFixed(3) : 0,
          mean:   mean.toFixed(3),
          median: pct(50).toFixed(3),
          p75:    pct(75).toFixed(3),
          p95:    pct(95).toFixed(3),
          p99:    pct(99).toFixed(3),
        },
        statusCodes,
        errorRate: n ? ((errors / (requests + errors)) * 100).toFixed(2) : '0.00',
      });
    }, durationSec * 1000);
  });
}

// ── Benchmark: measure algo selection time at various n ───────────
// ── Benchmark: measure algo selection time at various n ───────────
async function runBenchmark() {
  log('Running O(1) vs O(n) benchmark via /api/benchmark …');
  const sizes = [10, 100, 1000, 10000, 100000];
  const rows = [];
  for (const n of sizes) {
    try {
      const data = await new Promise((resolve, reject) => {
        http.get(`${EFFECTIVE_GATEWAY}/api/benchmark?n=${n}&iterations=100`, res => {
          let body = ''; res.on('data', d => body += d);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
        }).on('error', reject);
      });
      for (const r of (data.results || [])) {
        // Bug fix: benchmarkAlgorithm() returns 'timeComplexity', not 'complexity'
        rows.push({ n, algo: r.algo, avgMs: r.avgMs, complexity: r.timeComplexity });
      }
    } catch(e) { warn(`Benchmark n=${n} failed: ${e.message}`); }
  }
  return rows;
}

// ── Fetch live metrics ─────────────────────────────────────────────
async function fetchMetrics() {
  return new Promise((resolve) => {
    http.get(`${EFFECTIVE_GATEWAY}/api/metrics`, res => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

// ── CSV helpers ────────────────────────────────────────────────────
function toCSV(headers, rows) {
  const escape = v => (v === null || v === undefined) ? '' : String(v).includes(',') ? `"${v}"` : String(v);
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

// ── Detect Docker mode ─────────────────────────────────────────────
// If GATEWAY_URL env is set, services are already running (Docker mode)
const DOCKER_MODE = !!process.env.GATEWAY_URL;
const EFFECTIVE_GATEWAY = process.env.GATEWAY_URL || GATEWAY_URL;

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  console.log('\n\x1b[1m╔══════════════════════════════════════════════════╗');
  console.log('║   Phase 3: Stress Test & Data Collection         ║');
  console.log('║   Muhammad Abd Al-Jawad Al-Attar — 120250628     ║');
  console.log('╚══════════════════════════════════════════════════╝\x1b[0m\n');

  let svcProcs = [];
  let gwProc   = null;

  if (DOCKER_MODE) {
    log(`Docker mode detected — connecting to existing gateway at ${EFFECTIVE_GATEWAY}`);
    log('Waiting for gateway to be reachable …');
    try {
      await waitForPort(
        parseInt(new URL(EFFECTIVE_GATEWAY).port || 8080),
        40, 2000,
        new URL(EFFECTIVE_GATEWAY).hostname
      );
      ok('Gateway is ready!');
    } catch(e) {
      warn(`Gateway not ready: ${e.message}. Continuing anyway …`);
    }
    await sleep(2000);
  } else {
    // ── 1. Start microservices ─────────────────────────────────────
    log('Starting 3 microservice nodes …');
    const svcEnvs = [
      { PORT: '3001', SERVICE_NAME: 'Service_Node_A', WEIGHT: '1' },
      { PORT: '3002', SERVICE_NAME: 'Service_Node_B', WEIGHT: '2' },
      { PORT: '3003', SERVICE_NAME: 'Service_Node_C', WEIGHT: '3' },
    ];
    for (const env of svcEnvs) {
      svcProcs.push(spawnProcess(`svc-${env.PORT}`, 'node', ['server.js'], SVC_DIR, env));
    }

    // ── 2. Start gateway ───────────────────────────────────────────
    log('Starting API Gateway …');
    gwProc = spawnProcess('gateway', 'node', ['server.js'], GW_DIR, {
      PORT: String(GW_PORT),
      SERVICES: 'http://localhost:3001,http://localhost:3002,http://localhost:3003',
    });

    // ── 3. Wait until all ports are ready ─────────────────────────
    log('Waiting for services to be ready …');
    try {
      await Promise.all([
        ...SVC_PORTS.map(p => waitForPort(p, 20, 800)),
        waitForPort(GW_PORT, 25, 800),
      ]);
      ok('All services ready!');
    } catch(e) {
      warn(`Some services may not have started: ${e.message}. Continuing anyway …`);
    }
    await sleep(1500); // extra settle time
  }

  // ── 4. Warm-up ────────────────────────────────────────────────
  log(`Warm-up phase (${WARM_UP_SEC}s) …`);
  await runAutocannon(`${EFFECTIVE_GATEWAY}/route/rr?workload=read`, WARM_UP_SEC, 5);
  ok('Warm-up complete');

  // ── 5. Run scenarios ──────────────────────────────────────────
  const scenarioResults = [];
  for (const s of SCENARIOS) {
    log(`Running: ${s.label} …`);
    const result = await runAutocannon(`${EFFECTIVE_GATEWAY}${s.url}`, DURATION_SEC, CONNECTIONS);
    ok(`  ✓ ${result.requests} reqs | ${result.throughputRps} rps | p95=${result.latencyMs.p95}ms | errors=${result.errors}`);
    scenarioResults.push({ ...s, ...result });
  }

  // ── 6. O(1) vs O(n) Benchmark ────────────────────────────────
  const benchmarkRows = await runBenchmark();
  ok(`Benchmark complete: ${benchmarkRows.length} data points`);

  // ── 7. Live metrics snapshot ──────────────────────────────────
  const liveMetrics = await fetchMetrics();
  ok('Live metrics captured');

  // ── 8. Build synthesis JSON ───────────────────────────────────
  const synthesis = {
    generatedAt:  new Date().toISOString(),
    title:        'Analyzing the Complexity of Request Routing Algorithms in Microservices Architecture',
    author:       'Muhammad Abd Al-Jawad Al-Attar',
    universityId: '120250628',
    testConfig: {
      durationPerScenario: `${DURATION_SEC}s`,
      concurrentConnections: CONNECTIONS,
      scenarios: SCENARIOS.length,
      totalRequests: scenarioResults.reduce((s, r) => s + r.requests, 0),
    },
    scenarios: scenarioResults.map(r => ({
      label:         r.label,
      algo:          r.algo,
      workload:      r.workload,
      requests:      r.requests,
      throughputRps: parseFloat(r.throughputRps),
      errorRate:     parseFloat(r.errorRate),
      latencyMs: {
        min:    parseFloat(r.latencyMs.min),
        mean:   parseFloat(r.latencyMs.mean),
        median: parseFloat(r.latencyMs.median),
        p75:    parseFloat(r.latencyMs.p75),
        p95:    parseFloat(r.latencyMs.p95),
        p99:    parseFloat(r.latencyMs.p99),
        max:    parseFloat(r.latencyMs.max),
      },
      statusCodes: r.statusCodes,
    })),
    complexity: {
      benchmark:     benchmarkRows,
      interpretation: 'WLC avgMs grows linearly with n (O(n)); RR and Hash stay near-constant (O(1)).',
    },
    liveMetrics,
    recommendations: [
      'Round Robin / Hash: prefer for large n and high RPS — O(1) selection keeps latency flat.',
      'Weighted Least Connections: better load balance under heterogeneous compute, but O(n) per request.',
      'Centralized API Gateway: single network hop; becomes CPU bottleneck at very high concurrency.',
      'Decentralized sidecar mesh: higher memory O(k×n); stale metrics can cause herd-effect on WLC.',
    ],
  };

  // ── 9. Write JSON reports ─────────────────────────────────────
  const synthPath = path.join(REPORTS_DIR, 'synthesis-report.json');
  fs.writeFileSync(synthPath, JSON.stringify(synthesis, null, 2));
  fs.writeFileSync(path.join(REPORTS_DIR, 'report.json'), JSON.stringify(synthesis, null, 2));
  ok(`Written: reports/synthesis-report.json`);

  // Raw stress test data
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'stress-test-raw.json'),
    JSON.stringify({ generatedAt: synthesis.generatedAt, scenarios: scenarioResults, benchmark: benchmarkRows }, null, 2)
  );
  ok('Written: reports/stress-test-raw.json');

  // ── 10. Write CSV files ───────────────────────────────────────
  // Latency comparison CSV
  const latHeaders = ['algo', 'workload', 'latency_min_ms', 'latency_mean_ms', 'latency_median_ms', 'latency_p75_ms', 'latency_p95_ms', 'latency_p99_ms', 'latency_max_ms'];
  const latRows = synthesis.scenarios.map(s => ({
    algo:              s.algo,
    workload:          s.workload,
    latency_min_ms:    s.latencyMs.min,
    latency_mean_ms:   s.latencyMs.mean,
    latency_median_ms: s.latencyMs.median,
    latency_p75_ms:    s.latencyMs.p75,
    latency_p95_ms:    s.latencyMs.p95,
    latency_p99_ms:    s.latencyMs.p99,
    latency_max_ms:    s.latencyMs.max,
  }));
  fs.writeFileSync(path.join(REPORTS_DIR, 'latency-comparison.csv'), toCSV(latHeaders, latRows));
  ok('Written: reports/latency-comparison.csv');

  // Throughput + error rate CSV
  const tpHeaders = ['algo', 'workload', 'requests_total', 'throughput_rps', 'error_rate_pct', 'duration_sec'];
  const tpRows = synthesis.scenarios.map(s => ({
    algo:           s.algo,
    workload:       s.workload,
    requests_total: s.requests,
    throughput_rps: s.throughputRps,
    error_rate_pct: s.errorRate,
    duration_sec:   DURATION_SEC,
  }));
  fs.writeFileSync(path.join(REPORTS_DIR, 'throughput-comparison.csv'), toCSV(tpHeaders, tpRows));
  ok('Written: reports/throughput-comparison.csv');

  // Benchmark CSV (O(1) vs O(n))
  if (benchmarkRows.length > 0) {
    const bHeaders = ['n', 'algo', 'avgMs', 'complexity'];
    fs.writeFileSync(path.join(REPORTS_DIR, 'benchmark-complexity.csv'), toCSV(bHeaders, benchmarkRows));
    ok('Written: reports/benchmark-complexity.csv');
  }

  // ── 11. Summary table ─────────────────────────────────────────
  console.log('\n\x1b[1m┌────────────────────────────────────────────────────────────────────────┐');
  console.log('│                     STRESS TEST RESULTS SUMMARY                       │');
  console.log('├───────────────────────────┬──────────┬──────────┬──────────┬──────────┤');
  console.log('│ Scenario                  │  Req/s   │  p50 ms  │  p95 ms  │ Err%     │');
  console.log('├───────────────────────────┼──────────┼──────────┼──────────┼──────────┤');
  for (const r of scenarioResults) {
    const pad = (s, n) => String(s).padEnd(n).slice(0, n);
    console.log(`│ ${pad(r.label, 25)} │ ${pad(r.throughputRps, 8)} │ ${pad(r.latencyMs.median, 8)} │ ${pad(r.latencyMs.p95, 8)} │ ${pad(r.errorRate + '%', 8)} │`);
  }
  console.log('└───────────────────────────┴──────────┴──────────┴──────────┴──────────┘\x1b[0m');

  console.log('\n\x1b[32m✅ Phase 3 complete! Reports written to ./reports/\x1b[0m');
  if (DOCKER_MODE) {
    console.log('\x1b[33m   Open http://localhost:9090 in your browser for the live dashboard.\x1b[0m\n');
  } else {
    console.log('\x1b[33m   Next: open reports/dashboard.html in your browser.\x1b[0m\n');
  }

  // ── Cleanup ───────────────────────────────────────────────────
  if (!DOCKER_MODE) {
    if (gwProc)  gwProc.kill();
    for (const p of svcProcs) p.kill();
  }
  process.exit(0);
}

main().catch(e => {
  error(e.message);
  process.exit(1);
});
