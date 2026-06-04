const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const routingModel = require('../models/routingModel');

const normalizeWorkload = (req) => {
    const w = (req.query.workload || 'mixed').toLowerCase();
    return ['read', 'compute'].includes(w) ? w : 'mixed';
};

const handleRouting = async (req, res, algoOverride = null) => {
    const reqStart = performance.now();
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const workload = normalizeWorkload(req);

    if (req.query.n) {
        routingModel.setVirtualPoolSize(parseInt(req.query.n, 10));
    }

    let originalAlgo;
    if (algoOverride) {
        originalAlgo = routingModel.getAlgorithm();
        routingModel.setAlgorithm(algoOverride);
    }

    const algo = algoOverride || routingModel.getAlgorithm();
    const algoKey = algo === 'round-robin' ? 'roundRobin' : algo === 'hash' ? 'hashBased' : 'weightedLeastConnections';

    const t0 = performance.now();
    const targetNode = routingModel.selectNode(clientIp, algoOverride);
    const algoMs = performance.now() - t0;

    targetNode.totalRequests++;

    if (algoOverride) {
        routingModel.setAlgorithm(originalAlgo);
    }

    const backendUrl = `${targetNode.url}/api/process?workload=${workload}`;

    const sendSuccess = (response) => {
        res.json({
            algorithm: algoOverride === 'wlc' ? 'Weighted Least Connections' : algoOverride === 'rr' ? 'Round Robin' : algoOverride === 'hash' ? 'Hash-Based Routing' : routingModel.getAlgorithm(),
            complexity: algo === 'wlc' ? 'O(n)' : 'O(1)',
            workload,
            serverId: targetNode.id,
            serverName: targetNode.name,
            algorithmExecutionTimeMs: algoMs.toFixed(6),
            poolSize: routingModel.getNodes().length,
            virtualPoolSize: routingModel.getVirtualPoolSize(),
            backendResponse: response.data
        });
        routingModel.recordResponseTime(performance.now() - reqStart, workload);
        routingModel.recordHttpCode(200);
    };

    try {
        const response = await axios.get(backendUrl, { timeout: 5000 });
        sendSuccess(response);
    } catch (error) {
        routingModel.recordError(algoKey);
        try {
            const localUrl = backendUrl
                .replace('service1', 'localhost')
                .replace('service2', 'localhost')
                .replace('service3', 'localhost');
            const response = await axios.get(localUrl, { timeout: 5000 });
            sendSuccess(response);
        } catch (err) {
            routingModel.recordHttpCode(502);
            routingModel.recordResponseTime(performance.now() - reqStart, workload);
            res.status(502).json({ error: 'Bad Gateway. Node unavailable.', node: targetNode.name, workload });
        }
    }
};

exports.proxyRequest = (req, res) => handleRouting(req, res);
exports.routeRR = (req, res) => handleRouting(req, res, 'round-robin');
exports.routeWLC = (req, res) => handleRouting(req, res, 'wlc');
exports.routeHash = (req, res) => handleRouting(req, res, 'hash');

exports.getSettings = (req, res) => {
    res.json({
        algorithm: routingModel.getAlgorithm(),
        nodes: routingModel.getNodes(),
        virtualPoolSize: routingModel.getVirtualPoolSize(),
        gatewayMemory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
    });
};

exports.updateAlgorithm = (req, res) => {
    const { algo } = req.body;
    if (routingModel.setAlgorithm(algo)) {
        res.json({ message: `Algorithm updated successfully to ${algo}` });
    } else {
        res.status(400).json({ error: 'Invalid algorithm specified' });
    }
};

exports.setPoolSize = (req, res) => {
    const n = routingModel.setVirtualPoolSize(parseInt(req.body.n || req.query.n, 10));
    res.json({
        message: `Virtual pool size set to ${n} (physical replicas: ${routingModel.getNodes().length})`,
        virtualPoolSize: n,
        physicalNodes: routingModel.getNodes().length,
        spaceComplexity: `O(${n}) routing table entries`
    });
};

exports.getMetrics = (req, res) => {
    res.json(routingModel.getMetrics());
};

exports.runBenchmark = (req, res) => {
    const n = parseInt(req.query.n, 10) || 1000;
    const iterations = Math.min(parseInt(req.query.iterations, 10) || 100, 500);
    const algos = ['round-robin', 'wlc', 'hash'];
    const results = algos.map((algo) => routingModel.benchmarkAlgorithm(algo, n, iterations));
    res.json({
        virtualPoolSize: n,
        iterations,
        physicalNodes: routingModel.getNodes().length,
        results,
        interpretation: 'WLC avgMs should grow with n; RR and Hash should stay near-constant.'
    });
};

exports.getSimulation = (req, res) => {
    const n = parseInt(req.query.n, 10) || 10000;
    const k = parseInt(req.query.k, 10) || 5;
    const syncInterval = parseInt(req.query.sync, 10) || 200;
    const m = parseInt(req.query.m, 10) || 1000;
    const hopLatency = parseFloat(req.query.hop, 10) || 15;
    const algo = req.query.algo || 'wlc';

    const baseBackendMs = 10.0;
    let algoMs = 0.0;
    if (algo === 'rr') {
        algoMs = 0.005;
    } else if (algo === 'hash') {
        algoMs = 0.008;
    } else {
        algoMs = 0.0001 * n;
    }

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

    res.json({
        parameters: { n, k, syncInterval, m, hopLatency, algo },
        modelNote: 'Decentralized Service Mesh is a Queuing Network simulation — not a live Istio/Linkerd deployment.',
        centralized: {
            latency: {
                networkHopMs: centHop,
                routingAlgoMs: centAlgo,
                queuingDelayMs: centQueue,
                backendProcessMs: centBackend,
                totalMs: centTotal
            },
            space: {
                memoryMB: centMemoryMB,
                complexity: 'O(n)'
            },
            bottleneck: centQueue > 50 ? 'CPU Centralized Bottleneck' : 'None'
        },
        decentralized: {
            latency: {
                networkHopMs: decHop,
                routingAlgoMs: decAlgo,
                queuingDelayMs: decQueue,
                staleHerdDelayMs: decHerd,
                backendProcessMs: decBackend,
                totalMs: decTotal
            },
            space: {
                memoryMB: totalDecMemoryMB,
                complexity: 'O(k * n)'
            },
            syncOverhead: {
                messagesPerSec: gossipSyncRateSec,
                bandwidthKbps: syncBandwidthKbps
            },
            bottleneck: decHerd > 50 ? 'Load Imbalance (Stale Metrics)' : (gossipSyncRateSec > 1000 ? 'Network Sync Overload' : 'None')
        }
    });
};

exports.getSynthesisReport = (req, res) => {
    const reportPath = path.join(__dirname, '..', '..', 'reports', 'synthesis-report.json');
    if (fs.existsSync(reportPath)) {
        res.json(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
        return;
    }
    const metrics = routingModel.getMetrics();
    const n = routingModel.getVirtualPoolSize();
    res.json({
        generatedAt: new Date().toISOString(),
        note: 'Run npm run test:all to generate full synthesis-report.json with Artillery data.',
        liveMetrics: metrics,
        benchmark: {
            wlc: routingModel.benchmarkAlgorithm('wlc', n, 50),
            rr: routingModel.benchmarkAlgorithm('round-robin', n, 50)
        }
    });
};

exports.syncMetricsInBackground = async () => {
    const nodes = routingModel.getNodes();
    for (const node of nodes) {
        try {
            const response = await axios.get(`${node.url}/metrics`, { timeout: 1500 });
            node.activeConnections = response.data.activeConnections;
        } catch (err) {
            try {
                const localUrl = node.url.replace('service1', 'localhost').replace('service2', 'localhost').replace('service3', 'localhost');
                const response = await axios.get(`${localUrl}/metrics`, { timeout: 1500 });
                node.activeConnections = response.data.activeConnections;
            } catch (e) {
                // Node offline
            }
        }
    }
};
