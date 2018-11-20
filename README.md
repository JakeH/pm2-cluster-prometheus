# pm2-cluster-prometheus

Prometheus metrics aggregation for PM2's clustered mode.

Returns an aggregation of the default prom-client registry from all PM2 processes when running in clustered mode, otherwise, returns the current proc's metrics. 

```bash
$ npm install --save pm2-cluster-prometheus
```

## Usage

### ES6
```typescript
import { getAggregateMetrics } from 'pm2-cluster-prometheus';

const metrics = await getAggregateMetrics();
```

### Vanilla
```javascript
const clusterProm = require('pm2-cluster-prometheus');

clusterProm.getAggregateMetrics().then(metrics => {
    console.log(metrics);
});
```

As a general tip, if you're running in clustered mode, it would be a good idea to start your metrics collection at similar cycles to avoid jitter. 

```typescript
import { timeSyncRun } from 'pm2-cluster-prometheus';

const timeout = 15e3;
timeSyncRun(timeout, () => client.collectDefaultMetrics({ timeout }));
```

### // TODO: stuff

- [ ] Other-than-default registry
- [ ] Better exception handling
