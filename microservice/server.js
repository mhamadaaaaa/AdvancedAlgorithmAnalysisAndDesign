const express = require('express');
const metricsController = require('./controllers/metricsController');

const app = express();
const PORT = process.env.PORT || 3001;
const SERVICE_NAME = process.env.SERVICE_NAME || 'Node';

app.use(express.json());

// Log requests
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        console.log(`[${new Date().toISOString()}] [${SERVICE_NAME}] ${req.method} ${req.url} - ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
});

// Routes
app.get('/api/process', metricsController.processJob);
app.get('/metrics', metricsController.getMetrics);

app.listen(PORT, () => {
    console.log(`[MVC Microservice] ${SERVICE_NAME} online on port ${PORT} (Weight: ${process.env.WEIGHT || 1})`);
});
