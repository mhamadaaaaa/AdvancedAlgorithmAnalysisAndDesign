const os = require('os');
const connectionModel = require('../models/connectionModel');
const jsonView = require('../views/jsonView');

let lastCpu = process.cpuUsage();
let lastCpuWall = Date.now();

function getCpuPercent() {
    const now = Date.now();
    const elapsed = now - lastCpuWall;
    if (elapsed < 50) return 0;
    const delta = process.cpuUsage(lastCpu);
    const cores = os.cpus().length || 1;
    const pct = Math.min(100, ((delta.user + delta.system) / 1000 / elapsed / cores) * 100);
    lastCpu = process.cpuUsage();
    lastCpuWall = now;
    return Math.round(pct * 100) / 100;
}

function runCpuBurn(intensity) {
    const iterations = intensity === 'heavy' ? 800000 : 200000;
    let acc = 0;
    for (let i = 0; i < iterations; i++) {
        acc += Math.sqrt(i % 997) * Math.sin(i % 13);
    }
    return acc;
}

exports.processJob = (req, res) => {
    const workload = (req.query.workload || 'mixed').toLowerCase();
    connectionModel.incrementConnections();

    let delayMs;
    if (workload === 'read') {
        delayMs = Math.floor(Math.random() * 20) + 5;
    } else if (workload === 'compute') {
        runCpuBurn('heavy');
        delayMs = Math.floor(Math.random() * 150) + 100;
    } else {
        const isCompute = Math.random() < 0.35;
        if (isCompute) {
            runCpuBurn('light');
            delayMs = Math.floor(Math.random() * 200) + 80;
        } else {
            delayMs = Math.floor(Math.random() * 40) + 10;
        }
    }

    setTimeout(() => {
        const stats = connectionModel.getStats();
        stats.workload = workload;
        stats.processingDelayMs = delayMs;
        stats.cpuUsagePercent = getCpuPercent();
        connectionModel.decrementConnections();
        res.json(jsonView.renderSuccess(stats));
    }, delayMs);
};

exports.getMetrics = (req, res) => {
    const stats = connectionModel.getStats();
    stats.cpuUsagePercent = getCpuPercent();
    res.json(jsonView.renderMetrics(stats));
};
