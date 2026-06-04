const express = require('express');
const path = require('path');
const gatewayController = require('./controllers/gatewayController');

const app = express();
const PORT = 8080;

app.use(express.json());

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
});

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

app.use(express.static(path.join(__dirname, 'views')));
app.use('/reports', express.static(path.join(__dirname, '..', 'reports')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/proxy', gatewayController.proxyRequest);
app.get('/route/rr', gatewayController.routeRR);
app.get('/route/wlc', gatewayController.routeWLC);
app.get('/route/hash', gatewayController.routeHash);

app.get('/api/settings', gatewayController.getSettings);
app.post('/api/settings/algo', gatewayController.updateAlgorithm);
app.post('/api/settings/pool-size', gatewayController.setPoolSize);
app.get('/api/settings/pool-size', gatewayController.setPoolSize);

app.get('/api/metrics', gatewayController.getMetrics);
app.get('/api/benchmark', gatewayController.runBenchmark);
app.get('/api/simulation', gatewayController.getSimulation);
app.get('/simulation', gatewayController.getSimulation);
app.get('/api/synthesis-report', gatewayController.getSynthesisReport);

setInterval(gatewayController.syncMetricsInBackground, 1000);

app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  MVC Central API Gateway running on port ${PORT}`);
    console.log(`  Dashboard: /  |  Reports: /reports/report.json`);
    console.log(`  Endpoints: /proxy, /route/rr, /route/wlc, /route/hash`);
    console.log(`  Workloads: ?workload=read|compute|mixed`);
    console.log(`  Scale n:   ?n=1000  |  Benchmark: /api/benchmark?n=5000`);
    console.log(`======================================================\n`);
});
