# Neuron

Neuron is a an MQTT Sparkplug B Client for use with the project Kraken stack.

## Usage

### Host

To create a Sparkplug B host, wihch is meant to consume data and has the Primary Host feature Sparkplug B uses for implementing Store & Forward.

```typescript
import { nanoid } from "npm:nanoid";
import { SparkplugCreateHostInput } from "../types.d.ts";
import { createHost } from "../stateMachines/host.ts";

const config: SparkplugCreateHostInput = {
  brokerUrl: "ssl://mqtt3.anywherescada.com:8883",
  username: Deno.env.get("MQTT_USERNAME") || "",
  password: Deno.env.get("MQTT_PASSWORD") || "",
  id: "test",
  clientId: `test-${nanoid(7)}`,
  version: "spBv1.0",
  primaryHostId: "testHost",
};

const host = await createHost(config);
```

### (Edge) Node

To create a Sparkplug B node, which is meant to publish real time Sparkplug B data to hosts.

```typescript
import { nanoid } from "npm:nanoid";
import { createNode } from "../stateMachines/node.ts";
import {
  SparkplugCreateDeviceInput,
  SparkplugCreateNodeInput,
  SparkplugMetric,
} from "../types.d.ts";

const nodeMetrics: { [id: string]: SparkplugMetric } = {
  testNodeMetric1: {
    name: "testNodeMetric1",
    type: "Boolean",
    value: true,
    scanRate: 3000,
  },
  testNodeMetric2: {
    name: "testNodeMetric2",
    type: "Float",
    value: 1,
    scanRate: 1500,
  },
};

const metrics: { [id: string]: SparkplugMetric } = {
  testMetric: {
    name: "testMetric1",
    type: "Boolean",
    value: true,
    scanRate: 1000,
  },
  testMetric2: {
    name: "testMetric2",
    type: "Float",
    value: 1,
    scanRate: 1200,
  },
};

const devices: { [id: string]: SparkplugCreateDeviceInput } = {
  testDevice: {
    id: "testDevice",
    metrics,
  },
};

const config: SparkplugCreateNodeInput = {
  brokerUrl: "ssl://mqtt3.anywherescada.com:8883",
  username: Deno.env.get("MQTT_USERNAME") || "",
  password: Deno.env.get("MQTT_PASSWORD") || "",
  groupId: "test",
  id: "test",
  clientId: `test-${nanoid(7)}`,
  version: "spBv1.0",
  metrics: nodeMetrics,
  devices,
};

const node = await createNode(config);

setInterval(() => {
  if (typeof nodeMetrics["testNodeMetric1"].value === "number")
    node.metrics["testNodeMetric1"].value =
      nodeMetrics["testNodeMetric1"].value + 1;
  if (typeof metrics["testMetric"].value === "number")
    metrics["testMetric"].value = metrics["testMetric"].value + 1;
}, 5000);
```

## Environment Variables

NEURON_LOG_LEVEL: set to `debug`, `info`, `warn`, or `error` to control which logs are console logged.
