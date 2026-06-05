const crypto = require('crypto');
const { performance } = require('perf_hooks');
const os = require('os');

class RoutingModel {
    constructor() {
        this.currentAlgorithm = 'round-robin';
        this.rrIndex = 0;
        this.virtualPoolSize = 3;
        const servicesEnv = process.env.SERVICES;
        if (servicesEnv) {
            const urls = servicesEnv.split(',');
            this.nodes = urls.map((url, i) => ({
                id: i,
                name: `Service_Node_${String.fromCharCode(65 + i)}`,
                url: url.trim(),
                weight: i + 1,
                activeConnections: 0,
                totalRequests: 0
            }));
        } else {
            this.nodes = [
                { id: 0, name: 'Service_Node_A', url: 'http://service1:3001', weight: 1, activeConnections: 0, totalRequests: 0 },
                { id: 1, name: 'Service_Node_B', url: 'http://service2:3002', weight: 2, activeConnections: 0, totalRequests: 0 },
                { id: 2, name: 'Service_Node_C', url: 'http://service3:3003', weight: 3, activeConnections: 0, totalRequests: 0 }
            ];
        }

        this.MAX_SAMPLES = 1000;
        this.startTime = Date.now();
        this._lastCpu = process.cpuUsage();
        this._lastCpuWallMs = Date.now();
        this._cpuPercentSamples = [];

        this.metrics = {
            roundRobin: this.createMetricsBucket('Round Robin', 'O(1)', 'O(1)'),
            weightedLeastConnections: this.createMetricsBucket('Weighted Least Connections', 'O(n)', 'O(n)'),
            hashBased: this.createMetricsBucket('Hash-Based Routing', 'O(1)', 'O(n)')
        };

        this.responseTimeSamples = [];
        this.responseTimeByWorkload = { read: [], compute: [], mixed: [] };
        this.httpCodeCounts = { success: 0, error: 0, other: 0 };
        this.workloadCounts = { read: 0, compute: 0, mixed: 0 };
        this.rpsWindows = [];
        this._windowRequests = 0;
        this._windowStart = Date.now();
    }

    createMetricsBucket(name, timeBigO, spaceBigO) {
        return {
            name,
            timeBigO,
            spaceBigO,
            totalRequests: 0,
            totalExecutionTime: 0,
            minExecutionTimeMs: Infinity,
            maxExecutionTimeMs: 0,
            recentTimes: [],
            errors: 0
        };
    }

    setVirtualPoolSize(n) {
        const size = Math.max(this.nodes.length, Math.min(parseInt(n, 10) || this.nodes.length, 50000));
        this.virtualPoolSize = size;
        return this.virtualPoolSize;
    }

    getVirtualPoolSize() {
        return this.virtualPoolSize;
    }

    getEffectivePool() {
        if (this.virtualPoolSize <= this.nodes.length) return this.nodes;
        const pool = [];
        for (let i = 0; i < this.virtualPoolSize; i++) {
            const base = this.nodes[i % this.nodes.length];
            pool.push({
                ...base,
                virtualId: i,
                activeConnections: base.activeConnections + Math.floor(i / this.nodes.length) * 0.5
            });
        }
        return pool;
    }

    setAlgorithm(algo) {
        if (['round-robin', 'hash', 'wlc'].includes(algo)) {
            this.currentAlgorithm = algo;
            return true;
        }
        return false;
    }

    getAlgorithm() {
        return this.currentAlgorithm;
    }

    getNodes() {
        return this.nodes;
    }

    updateCpuUsage() {
        const nowWall = Date.now();
        const elapsedMs = nowWall - this._lastCpuWallMs;
        if (elapsedMs < 100) return;

        const nowCpu = process.cpuUsage(this._lastCpu);
        const cpuMicros = nowCpu.user + nowCpu.system;
        const cores = os.cpus().length || 1;
        const pct = Math.min(100, (cpuMicros / 1000 / elapsedMs / cores) * 100);

        this._cpuPercentSamples.push(pct);
        if (this._cpuPercentSamples.length > 60) this._cpuPercentSamples.shift();

        this._lastCpu = process.cpuUsage();
        this._lastCpuWallMs = nowWall;
    }

    getCpuUsagePercent() {
        if (!this._cpuPercentSamples.length) return 0;
        return this._cpuPercentSamples.reduce((a, b) => a + b, 0) / this._cpuPercentSamples.length;
    }

    selectNode(clientIp, algoOverride = null) {
        const algo = algoOverride || this.currentAlgorithm;
        const t0 = performance.now();
        let selectedNode;
        const pool = this.getEffectivePool();
        const metricKey = algo === 'round-robin' ? 'roundRobin' : algo === 'hash' ? 'hashBased' : 'weightedLeastConnections';

        if (algo === 'round-robin') {
            selectedNode = pool[this.rrIndex % pool.length];
            this.rrIndex++;
        } else if (algo === 'hash') {
            const hash = crypto.createHash('md5').update(String(clientIp)).digest('hex');
            const index = parseInt(hash.substring(0, 8), 16) % pool.length;
            selectedNode = pool[index];
        } else if (algo === 'wlc') {
            let bestNode = pool[0];
            let minRatio = (bestNode.activeConnections + 1) / bestNode.weight;
            for (let i = 1; i < pool.length; i++) {
                const ratio = (pool[i].activeConnections + 1) / pool[i].weight;
                if (ratio < minRatio) {
                    minRatio = ratio;
                    bestNode = pool[i];
                }
            }
            selectedNode = bestNode;
        } else {
            selectedNode = pool[0];
        }

        const algoMs = performance.now() - t0;
        this.recordMetric(metricKey, algoMs);

        const physicalNode = this.nodes[selectedNode.id !== undefined ? selectedNode.id : (selectedNode.virtualId % this.nodes.length)];
        return physicalNode || this.nodes[0];
    }

    benchmarkAlgorithm(algo, n, iterations) {
        const savedPool = this.virtualPoolSize;
        const savedAlgo = this.currentAlgorithm;
        this.setVirtualPoolSize(n);

        const times = [];
        for (let i = 0; i < iterations; i++) {
            const t0 = performance.now();
            this.selectNode(`bench-${i}`, algo);
            times.push(performance.now() - t0);
        }

        this.setVirtualPoolSize(savedPool);
        this.currentAlgorithm = savedAlgo;

        times.sort((a, b) => a - b);
        const sum = times.reduce((a, b) => a + b, 0);
        return {
            algo,
            virtualPoolSize: n,
            iterations,
            timeComplexity: algo === 'wlc' ? 'O(n)' : 'O(1)',
            avgMs: sum / iterations,
            minMs: times[0],
            maxMs: times[times.length - 1],
            p95Ms: this.percentile(times, 95),
            p99Ms: this.percentile(times, 99)
        };
    }

    recordMetric(algoKey, ms) {
        const m = this.metrics[algoKey];
        if (!m) return;
        m.totalRequests++;
        m.totalExecutionTime += ms;
        if (ms < m.minExecutionTimeMs) m.minExecutionTimeMs = ms;
        if (ms > m.maxExecutionTimeMs) m.maxExecutionTimeMs = ms;
        m.recentTimes.push(ms);
        if (m.recentTimes.length > this.MAX_SAMPLES) m.recentTimes.shift();
    }

    recordError(algoKey) {
        const m = this.metrics[algoKey];
        if (m) m.errors++;
    }

    recordResponseTime(ms, workload = 'mixed') {
        this.responseTimeSamples.push(ms);
        if (this.responseTimeSamples.length > this.MAX_SAMPLES) this.responseTimeSamples.shift();

        const wKey = ['read', 'compute'].includes(workload) ? workload : 'mixed';
        this.workloadCounts[wKey]++;
        this.responseTimeByWorkload[wKey].push(ms);
        if (this.responseTimeByWorkload[wKey].length > 500) this.responseTimeByWorkload[wKey].shift();

        this._windowRequests++;
        const now = Date.now();
        if (now - this._windowStart >= 1000) {
            this.rpsWindows.push({ label: 'T' + (this.rpsWindows.length + 1), rps: this._windowRequests });
            if (this.rpsWindows.length > 30) this.rpsWindows.shift();
            this._windowRequests = 0;
            this._windowStart = now;
        }
    }

    recordHttpCode(code) {
        if (code >= 200 && code < 300) this.httpCodeCounts.success++;
        else if (code >= 500) this.httpCodeCounts.error++;
        else this.httpCodeCounts.other++;
    }

    percentile(sorted, p) {
        if (!sorted.length) return 0;
        const i = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, i)];
    }

    workloadLatencySummary(key) {
        const arr = [...this.responseTimeByWorkload[key]].sort((a, b) => a - b);
        return {
            count: this.workloadCounts[key],
            medianMs: this.percentile(arr, 50),
            p95Ms: this.percentile(arr, 95)
        };
    }

    getMetrics() {
        this.updateCpuUsage();
        const result = {};
        for (const [key, m] of Object.entries(this.metrics)) {
            const sorted = [...m.recentTimes].sort((a, b) => a - b);
            result[key] = {
                name: m.name,
                timeComplexity: m.timeBigO,
                spaceComplexity: m.spaceBigO,
                totalRequests: m.totalRequests,
                errors: m.errors,
                avgExecutionTimeMs: m.totalRequests ? m.totalExecutionTime / m.totalRequests : 0,
                minExecutionTimeMs: m.minExecutionTimeMs === Infinity ? 0 : m.minExecutionTimeMs,
                maxExecutionTimeMs: m.maxExecutionTimeMs,
                p50ExecutionTimeMs: this.percentile(sorted, 50),
                p95ExecutionTimeMs: this.percentile(sorted, 95),
                p99ExecutionTimeMs: this.percentile(sorted, 99),
                recentSamples: sorted.length
            };
        }

        const respSorted = [...this.responseTimeSamples].sort((a, b) => a - b);
        const mem = process.memoryUsage();
        const routingTableBytes = this.virtualPoolSize * 100;

        return {
            algorithms: result,
            system: {
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
                serverPoolSize: this.nodes.length,
                virtualPoolSize: this.virtualPoolSize,
                totalRequests: Object.values(this.metrics).reduce((s, m) => s + m.totalRequests, 0),
                nodeVersion: process.version,
                memoryUsageMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
                memoryRssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
                routingTableEstimateKB: Math.round(routingTableBytes / 1024 * 100) / 100,
                cpuUsagePercent: Math.round(this.getCpuUsagePercent() * 100) / 100,
                cpuCores: os.cpus().length,
                responseLatency: {
                    samples: respSorted.length,
                    minMs: respSorted.length ? respSorted[0] : 0,
                    medianMs: this.percentile(respSorted, 50),
                    p95Ms: this.percentile(respSorted, 95),
                    p99Ms: this.percentile(respSorted, 99),
                    maxMs: respSorted.length ? respSorted[respSorted.length - 1] : 0
                },
                workloadBreakdown: {
                    read: this.workloadLatencySummary('read'),
                    compute: this.workloadLatencySummary('compute'),
                    mixed: this.workloadLatencySummary('mixed')
                },
                httpCodes: { ...this.httpCodeCounts },
                rpsHistory: [...this.rpsWindows]
            }
        };
    }
}

module.exports = new RoutingModel();
