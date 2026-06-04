/**
 * Aggregates Artillery JSON reports + live gateway metrics into synthesis-report.json
 * Run after: npm run test:all  OR  manually when gateway is up: npm run report
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:9090';

function readJsonSafe(filePath) {
    try {
        if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) { /* ignore */ }
    return null;
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function summarizeArtillery(raw, label) {
    if (!raw) return { label, available: false };
    const agg = raw.aggregate || raw;
    const lat = agg.latency || {};
    const rates = agg.rates || {};
    const counters = agg.counters || {};
    return {
        label,
        available: true,
        durationSec: agg.duration,
        requestsTotal: counters['http.requests'] || counters['vusers.created'] || null,
        throughputRps: rates['http.request_rate'] || null,
        latencyMs: {
            min: lat.min,
            max: lat.max,
            median: lat.median,
            p95: lat.p95,
            p99: lat.p99
        },
        errors: counters['errors.ETIMEDOUT'] || counters['vusers.failed'] || 0,
        httpCodes: Object.fromEntries(
            Object.entries(counters).filter(([k]) => k.startsWith('http.codes.'))
        )
    };
}

async function main() {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const artilleryReports = {
        readHeavy: summarizeArtillery(readJsonSafe(path.join(REPORTS_DIR, 'report-read-heavy.json')), 'read-heavy'),
        computeHeavy: summarizeArtillery(readJsonSafe(path.join(REPORTS_DIR, 'report-compute-heavy.json')), 'compute-heavy'),
        mixed: summarizeArtillery(readJsonSafe(path.join(REPORTS_DIR, 'report-mixed.json')), 'mixed')
    };

    let liveMetrics = null;
    let benchmark = null;
    let simulation = null;
    try {
        liveMetrics = await fetchJson(`${GATEWAY}/api/metrics`);
        benchmark = await fetchJson(`${GATEWAY}/api/benchmark?n=1000&iterations=50`);
        simulation = await fetchJson(`${GATEWAY}/api/simulation?n=10000&k=5&m=1000&algo=wlc`);
    } catch (e) {
        console.warn('Gateway not reachable — synthesis will use Artillery data only.');
    }

    const synthesis = {
        generatedAt: new Date().toISOString(),
        title: 'Analyzing the Complexity of Request Routing Algorithms in Microservices Architecture',
        author: 'Muhammad Abd Al-Jawad Al-Attar',
        universityId: '120250628',
        phase4: {
            theoreticalVsEmpirical: liveMetrics ? {
                algorithms: liveMetrics.algorithms,
                system: liveMetrics.system,
                note: 'Empirical metrics from live gateway; compare avgExecutionTimeMs with Big-O predictions.'
            } : null,
            scalabilityBenchmark: benchmark,
            architecturalSimulation: simulation ? {
                parameters: simulation.parameters,
                centralizedTotalMs: simulation.centralized?.latency?.totalMs,
                decentralizedTotalMs: simulation.decentralized?.latency?.totalMs,
                serviceMeshNote: 'Decentralized Service Mesh scenario is a Queuing Network model (not a live Istio deployment).'
            } : null,
            artilleryStressTests: artilleryReports,
            recommendations: [
                'Round Robin / Hash: prefer for large n and high RPS (O(1) selection).',
                'Weighted Least Connections: better load balance under heterogeneous compute, but O(n) per request.',
                'Centralized API Gateway: extra network hop; bottleneck shifts to gateway CPU under high m.',
                'Decentralized sidecar mesh: higher memory O(k×n); stale metrics can cause herd delays on WLC.'
            ]
        }
    };

    const outPath = path.join(REPORTS_DIR, 'synthesis-report.json');
    fs.writeFileSync(outPath, JSON.stringify(synthesis, null, 2));
    fs.writeFileSync(path.join(REPORTS_DIR, 'report.json'), JSON.stringify(synthesis, null, 2));
    console.log('Written:', outPath);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
