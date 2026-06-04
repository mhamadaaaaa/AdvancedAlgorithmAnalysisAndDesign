class JsonView {
    renderSuccess(data) {
        return {
            status: 'success',
            timestamp: new Date().toISOString(),
            data: data
        };
    }

    renderMetrics(metrics) {
        return {
            node: metrics.node,
            port: parseInt(metrics.port, 10),
            weight: parseInt(metrics.weight, 10),
            activeConnections: parseInt(metrics.activeConnections, 10),
            totalHandled: parseInt(metrics.totalHandled, 10),
            memoryUsage: parseFloat(metrics.memoryUsage)
        };
    }
}

module.exports = new JsonView();
