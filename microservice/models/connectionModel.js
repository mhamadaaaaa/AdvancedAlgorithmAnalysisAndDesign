class ConnectionModel {
    constructor() {
        this.port = process.env.PORT || 3001;
        this.serviceName = process.env.SERVICE_NAME || 'Generic_Service_Node';
        this.weight = parseInt(process.env.WEIGHT || '1', 10);
        this.activeConnections = 0;
        this.totalHandled = 0;
    }

    incrementConnections() {
        this.activeConnections++;
        this.totalHandled++;
    }

    decrementConnections() {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
    }

    getStats() {
        return {
            node: this.serviceName,
            port: this.port,
            weight: this.weight,
            activeConnections: this.activeConnections,
            totalHandled: this.totalHandled,
            memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)
        };
    }
}

module.exports = new ConnectionModel();
