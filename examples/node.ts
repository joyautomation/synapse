import { nanoid } from "nanoid";
import { createNode } from "../stateMachines/node.ts";
import type {
  SparkplugCreateDeviceInput,
  SparkplugCreateNodeInput,
  SparkplugMetric,
} from "../types.ts";

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
  testMetric1: {
    name: "testMetric1",
    type: "Boolean",
    value: true,
    scanRate: 1000,
  },
  testMetric2: {
    deadband: {
      value: 3,
      maxTime: 60,
    },
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
  brokerUrl:
    Deno.env.get("MQTT_BROKER_URL") || "ssl://mqtt3.anywherescada.com:8883",
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
  if (typeof nodeMetrics["testNodeMetric1"].value === "number") {
    node.metrics["testNodeMetric1"].value =
      nodeMetrics["testNodeMetric1"].value + 1;
  }
  if (typeof metrics["testMetric2"].value === "number") {
    metrics["testMetric2"].value = metrics["testMetric2"].value + 1;
  }
}, 1000);
