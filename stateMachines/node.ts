import EventEmitter from "node:events";
import type {
  SparkplugCreateNodeInput,
  SparkplugDevice,
  SparkplugMetric,
  SparkplugNode,
  SparkplugNodeScanRates,
} from "../types.ts";
import { pipe } from "@joyautomation/dark-matter";
import {
  createMqttClient,
  createSpbTopic,
  destroyMqttClient,
  publishDeviceData,
  publishNodeBirth,
  publishNodeData,
  publishNodeDeath,
  subscribeCurry,
} from "../mqtt.ts";
import type {
  UMetric,
  UPayload,
} from "sparkplug-payload/lib/sparkplugbpayload.js";
import { logs } from "../log.ts";
const { main: log } = logs;
import { someTrue } from "../utils.ts";
import { birthDevice, createDevice, killDevice } from "./device.ts";
import { setStateCurry } from "../utils.ts";
import {
  cleanUpEventListeners,
  evaluateMetrics,
  evaluateMetricValue,
  flatten,
  getMqttConfigFromSparkplug,
  on,
  onCurry,
} from "./utils.ts";
import type { NodeEvent, NodeTransition } from "./types.ts";
import { onMessage } from "./utils.ts";
import type mqtt from "mqtt";
import type { OnConnectCallback, OnDisconnectCallback } from "mqtt";

/**
 * Handles the connection event for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to handle the connection for.
 * @returns {() => void} A function to be called when the connection is established.
 */
const onConnect = (node: SparkplugNode) => {
  return async () => {
    setNodeStateConnected(node);
    log.info(
      `${node.id} connected to ${node.brokerUrl} with user ${node.username}`
    );
    node.events.emit("connected");
    birthNode(node);
    for (const device of Object.values(node.devices)) {
      await killDevice(node, device);
      await birthDevice(node, device);
    }
    killScans(node);
    node.scanRates = startScans(node);
  };
};

/**
 * Handles the disconnection event for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to handle the disconnection for.
 * @returns {() => void} A function to be called when the disconnection occurs.
 */
const onDisconnect = (node: SparkplugNode): OnDisconnectCallback => {
  return () => {
    killScans(node);
    setNodeStateDisconnected(node);
    log.info(`${node.id} disconnected`);
    node.events.emit("disconnected");
  };
};

/**
 * Handles the close event for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to handle the close event for.
 * @returns {() => void} A function to be called when the connection is closed.
 */
const onClose = (node: SparkplugNode) => {
  return () => {
    setNodeStateDisconnected(node);
    log.info(`${node.id} closed`);
    node.events.emit("closed");
  };
};

/**
 * Handles the error event for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to handle the error event for.
 * @returns {(error: Error) => void} A function to be called when an error occurs.
 */
const onError = (node: SparkplugNode) => {
  return (error: Error) => {
    setNodeStateDisconnected(node);
    log.error(error);
    node.events.emit("error", error);
  };
};

/**
 * Object containing node command functions.
 */
export const nodeCommands = {
  rebirth: (node: SparkplugNode) =>
    pipe(node, killNode, disconnectNode, connectNode),
};

/**
 * Derives node commands from a UPayload message.
 * @param {UPayload} message - The message containing metrics.
 * @returns {string[] | undefined} An array of derived command names.
 */
const deriveNodeCommands = (message: UPayload) =>
  message.metrics?.map((metric) =>
    metric.name?.replace("Node Control/", "").toLowerCase()
  );

/**
 * Creates a function to handle node commands.
 * @param {SparkplugNode} node - The Sparkplug node to handle commands for.
 * @returns {(topic: string, message: UPayload) => void} A function that processes node commands.
 */
const onNodeCommand = (node: SparkplugNode) => {
  return (_topic: string, message: UPayload) => {
    deriveNodeCommands(message)?.forEach((command) => {
      nodeCommands[command as keyof typeof nodeCommands]?.(node);
    });
  };
};

/**
 * Sets up event listeners for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to set up events for.
 */
const setupNodeEvents = (node: SparkplugNode) => {
  if (node.mqtt) {
    pipe(
      node.mqtt,
      onCurry<mqtt.MqttClient, "connect", OnConnectCallback>(
        "connect",
        onConnect(node)
      ),
      onCurry<mqtt.MqttClient, "message", mqtt.OnMessageCallback>(
        "message",
        onMessage(node)
      ),
      onCurry<mqtt.MqttClient, "disconnect", mqtt.OnDisconnectCallback>(
        "disconnect",
        onDisconnect(node)
      ),
      onCurry<mqtt.MqttClient, "close", mqtt.OnCloseCallback>(
        "close",
        onClose(node)
      ),
      onCurry<mqtt.MqttClient, "error", mqtt.OnErrorCallback>(
        "error",
        onError(node)
      ),
      subscribeCurry(
        `${createSpbTopic("DCMD", getMqttConfigFromSparkplug(node))}`,
        {
          qos: 0,
        }
      ),
      subscribeCurry(
        `${createSpbTopic("NCMD", getMqttConfigFromSparkplug(node))}`,
        {
          qos: 0,
        }
      ),
      subscribeCurry("STATE/#", { qos: 1 })
    );
  }
  on<
    SparkplugNode["events"],
    NodeEvent,
    (topic: string, message: UPayload) => void
  >("ncmd", onNodeCommand(node), node.events);
};

/**
 * Object containing node state transition functions.
 */
export const nodeTransitions = {
  connect: (node: SparkplugNode) => {
    node.mqtt = createMqttClient(getMqttConfigFromSparkplug(node), node.bdseq);
    return setupNodeEvents(node);
  },
  disconnect: (node: SparkplugNode) => {
    killNode(node);
    destroyMqttClient(node.mqtt);
    cleanUpEventListeners(node.events);
    return setNodeStateDisconnected(node);
  },
  birth: async (node: SparkplugNode) => {
    if (node.mqtt) {
      publishNodeBirth(
        node.bdseq,
        node.seq,
        undefined,
        getNodeBirthPayload(await evaluateMetrics(node.metrics)),
        getMqttConfigFromSparkplug(node),
        node.mqtt
      );
    } else {
      log.warn("Node birth called without MQTT client");
    }
    return node;
  },
  death: (node: SparkplugNode) => {
    if (node.mqtt) {
      publishNodeDeath(node.bdseq, getMqttConfigFromSparkplug(node), node.mqtt);
    }
    return node;
  },
};

/**
 * Gets the current state of a Sparkplug node as a string.
 * @param {SparkplugNode} node - The Sparkplug node to get the state for.
 * @returns {string} The current state of the node as a string.
 */
export const getNodeStateString = (node: SparkplugNode) => {
  if (node.states.disconnected) {
    return "disconnected";
  } else if (node.states.connected.born) {
    return "born";
  } else if (node.states.connected.dead) {
    return "dead";
  } else {
    return `unknown state: ${JSON.stringify(node.states)}`;
  }
};

/**
 * Resets the state of a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to reset.
 * @returns {SparkplugNode} The node with reset state.
 */
const resetNodeState = (node: SparkplugNode) => {
  node.states = {
    connected: { born: false, dead: false },
    disconnected: false,
  };
  return node;
};

/**
 * Creates a function to set a specific node state.
 * @param {Partial<SparkplugNode["states"]>} state - The partial state to set.
 * @returns {(node: SparkplugNode) => SparkplugNode} A function that sets the specified state.
 */
const deriveSetNodeState =
  (state: Partial<SparkplugNode["states"]>) => (node: SparkplugNode) =>
    pipe(
      node,
      resetNodeState,
      setStateCurry<SparkplugNode, SparkplugNode["states"]>(state)
    );

/**
 * Sets the node state to connected.
 * @type {(node: SparkplugNode) => SparkplugNode}
 */
const setNodeStateConnected = deriveSetNodeState({
  connected: { born: false, dead: true },
});

/**
 * Sets the node state to disconnected.
 * @type {(node: SparkplugNode) => SparkplugNode}
 */
const setNodeStateDisconnected = deriveSetNodeState({ disconnected: true });

/**
 * Sets the node state to born.
 * @type {(node: SparkplugNode) => SparkplugNode}
 */
const setNodeStateBorn = deriveSetNodeState({
  connected: { born: true, dead: false },
});

/**
 * Sets the node state to dead.
 * @type {(node: SparkplugNode) => SparkplugNode}
 */
const setNodeStateDead = deriveSetNodeState({
  connected: { born: false, dead: true },
});

/**
 * Changes the state of a Sparkplug node based on conditions and transitions.
 * @param {(node: SparkplugNode) => boolean} inRequiredState - Function to check if the node is in the required state.
 * @param {string} notInRequiredStateLogText - Text to log if the node is not in the required state.
 * @param {NodeTransition} transition - The transition to apply.
 * @param {SparkplugNode} node - The Sparkplug node to change state for.
 * @returns {SparkplugNode} The node after the state change attempt.
 */
const changeNodeState = (
  inRequiredState: (node: SparkplugNode) => boolean,
  notInRequiredStateLogText: string,
  transition: NodeTransition,
  node: SparkplugNode
) => {
  if (!inRequiredState(node)) {
    log.info(
      `${notInRequiredStateLogText}, it is currently: ${getNodeStateString(
        node
      )}`
    );
  } else {
    log.info(
      `Node ${node.id} transitioning from ${getNodeStateString(
        node
      )} to ${transition}`
    );
    nodeTransitions[transition](node);
  }
  return node;
};

const changeNodeStateCurry =
  (
    inRequiredState: (node: SparkplugNode) => boolean,
    notInRequiredStateLogText: string,
    transition: NodeTransition
  ) =>
  (node: SparkplugNode) =>
    changeNodeState(
      inRequiredState,
      notInRequiredStateLogText,
      transition,
      node
    );

/**
 * Gets the node birth payload.
 * @param {UMetric[] | undefined} metrics - The metrics to include in the birth payload.
 * @returns {UPayload} The node birth payload.
 */
export const getNodeBirthPayload = (
  metrics: UMetric[] | undefined
): UPayload => ({
  timestamp: Date.now(),
  metrics: [
    {
      name: "Node Control/Rebirth",
      timestamp: Date.now(),
      type: "Boolean",
      value: false,
    },
    ...(metrics || []),
  ],
});

/**
 * Births a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to birth.
 * @returns {SparkplugNode} The birthed node.
 */
const birthNode = (node: SparkplugNode) =>
  pipe(
    node,
    changeNodeStateCurry(
      (node: SparkplugNode) => node.states.connected.dead,
      "Node needs to be dead to be born",
      "birth"
    ),
    setNodeStateBorn
  );

/**
 * Kills a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to kill.
 * @returns {SparkplugNode} The killed node.
 */
const killNode = (node: SparkplugNode) =>
  pipe(
    node,
    changeNodeStateCurry(
      (node: SparkplugNode) => node.states.connected.born,
      "Node needs to be born to be dead",
      "death"
    ),
    setNodeStateDead
  );

/**
 * Connects a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to connect.
 * @returns {SparkplugNode} The connected node.
 */
const connectNode = changeNodeStateCurry(
  (node: SparkplugNode) => node.states.disconnected,
  "Node needs to be disconnected to be connected",
  "connect"
);

/**
 * Disconnects a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to disconnect.
 * @returns {SparkplugNode} The disconnected node.
 */
export const disconnectNode: (node: SparkplugNode) => SparkplugNode =
  changeNodeStateCurry(
    (node: SparkplugNode) => someTrue(...Object.values(node.states.connected)),
    "Node needs to be connected to be disconnected",
    "disconnect"
  );
/**
 * Sets the last published timestamp and value for a given metric in a Sparkplug Node or Device.
 *
 * @param {SparkplugNode | SparkplugDevice} parent - The parent node or device containing the metric.
 * @param {SparkplugMetric} metric - The metric to update.
 */
export const setLastPublished = async (
  parent: SparkplugNode | SparkplugDevice,
  metric: SparkplugMetric
) => {
  if (metric.name && metric.value) {
    parent.metrics[metric.name].lastPublished = {
      timestamp: Date.now(),
      value: await evaluateMetricValue(metric),
    };
  }
};

/**
 * Determines if a given Sparkplug metric type represents a numeric value.
 *
 * @param {SparkplugMetric["type"]} metricType - The type of the Sparkplug metric to check.
 * @returns {boolean} True if the metric type is numeric, false otherwise.
 *
 * @description
 * This function checks if the provided metric type is one of the following numeric types:
 * Int8, Int16, Int32, Int64, UInt8, UInt16, UInt32, UInt64, Float, or Double.
 * It's used to determine if a metric can be subject to numeric operations or comparisons.
 */
const isNumberType = (metricType: SparkplugMetric["type"]): boolean =>
  [
    "Int8",
    "Int16",
    "Int32",
    "Int64",
    "UInt8",
    "UInt16",
    "UInt32",
    "UInt64",
    "Float",
    "Double",
  ].includes(metricType);

/**
 * Determines if a metric needs to be published based on its deadband settings and last published value.
 *
 * @param {SparkplugMetric} metric - The metric to evaluate.
 * @returns {boolean} True if the metric needs to be published, false otherwise.
 *
 * @description
 * This function checks if a metric needs to be published based on the following criteria:
 * 1. If the metric has never been published before (no lastPublished data).
 * 2. If the metric's current value is different from its last published value.
 * 3. If the metric's type is not a number type or it doesn't have deadband settings.
 * 4. For numeric metrics with deadband settings:
 *    a. If the time since last publish exceeds the maximum time specified in the deadband.
 *    b. If the difference between the current value and last published value exceeds the deadband value.
 *
 * The function handles both numeric and non-numeric metric types, applying appropriate comparison logic for each.
 */
export const metricNeedsToPublish = (metric: SparkplugMetric) => {
  if (
    !metric.lastPublished ||
    metric.lastPublished.value == null ||
    !isNumberType(metric.type) ||
    !metric.deadband
  ) {
    if (metric.value !== metric.lastPublished?.value) {
      logs.rbe.debug(
        `Metric ${metric.name} needs to be published, because it's value changed. ${metric.value} vs ${metric.lastPublished?.value}`
      );
      return true;
    }
  }

  const now = Date.now();
  const timeSinceLastPublish = now - metric.lastPublished!.timestamp;
  const valueDifference = Math.abs(
    (metric.value as number) - Number(metric.lastPublished!.value)
  );

  if (metric.deadband?.value && valueDifference > metric.deadband.value) {
    logs.rbe.debug(
      `Metric ${metric.name} needs to be published, because it's value changed. ${metric.value} vs ${metric.lastPublished?.value}`
    );
    return true;
  } else if (
    metric.deadband?.maxTime &&
    timeSinceLastPublish > metric.deadband.maxTime
  ) {
    logs.rbe.debug(
      `Metric ${metric.name} needs to be published, because it's max time has been exceeded. ${timeSinceLastPublish} sec > ${metric.deadband.maxTime} sec`
    );
    return true;
  }
  logs.rbe.debug(
    `Metric ${metric.name} does not need to be published. ${timeSinceLastPublish} < ${metric.deadband?.maxTime}, ${metric.value} vs. ${metric.lastPublished?.value}`
  );
  return false;
};

/**
 * Publishes metrics for a Sparkplug node and its devices.
 * @param {SparkplugNode} node - The Sparkplug node to publish metrics for.
 * @param {number} [scanRate] - The scan rate to filter metrics by.
 * @param {(metric: SparkplugMetric) => boolean} [metricSelector] - A function to select which metrics to publish.
 */
export const publishMetrics = async (
  node: SparkplugNode,
  scanRate?: number,
  metricSelector: (metric: SparkplugMetric) => boolean = () => true
) => {
  const evaluatedMetrics = await evaluateMetrics(node.metrics);
  const nodeMetrics = evaluatedMetrics.filter(
    (metric) => metric.scanRate === scanRate && metricNeedsToPublish(metric)
  );
  if (nodeMetrics.length > 0 && node.mqtt) {
    publishNodeData(
      node,
      {
        timestamp: Date.now(),
        metrics: nodeMetrics.map((metric) => ({
          ...metric,
          timestamp: Date.now(),
        })),
      },
      getMqttConfigFromSparkplug(node),
      node.mqtt
    );
  }
  nodeMetrics.forEach((metric) => setLastPublished(node, metric));
  for (const device of flatten(node.devices)) {
    const evaluatedMetrics = await evaluateMetrics(device.metrics);
    const metrics = evaluatedMetrics.filter(
      (metric) =>
        metricSelector(metric) &&
        (scanRate == null || metric.scanRate === scanRate) &&
        metricNeedsToPublish(metric)
    );
    if (metrics.length > 0 && node.mqtt) {
      publishDeviceData(
        node,
        {
          timestamp: Date.now(),
          metrics: metrics.map((metric) => ({
            ...metric,
            timestamp: Date.now(),
          })),
        },
        getMqttConfigFromSparkplug(node),
        node.mqtt,
        device.id
      );
      metrics.forEach((metric) => setLastPublished(device, metric));
    }
  }
};

/**
 * Starts scan intervals for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to start scans for.
 * @returns {SparkplugNodeScanRates} An object containing the started scan intervals.
 */
export const startScans = (node: SparkplugNode) => {
  const scanRates = [
    ...new Set(
      [
        ...flatten(node.metrics),
        ...flatten(node.devices).reduce(
          (acc, devices) => acc.concat(flatten(devices.metrics)),
          [] as SparkplugMetric[]
        ),
      ].map((metric) => metric.scanRate)
    ),
  ];
  return scanRates.reduce((acc, scanRate) => {
    if (scanRate != null) {
      acc[scanRate] = setInterval(
        () => publishMetrics(node, scanRate),
        scanRate
      );
    }
    return acc;
  }, {} as SparkplugNodeScanRates);
};

/**
 * Stops all scan intervals for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to stop scans for.
 */
export const killScans = (node: SparkplugNode) => {
  Object.values(node.scanRates).forEach((scanRate) => clearInterval(scanRate));
};

/**
 * Creates a new Sparkplug node.
 * @param {SparkplugCreateNodeInput} config - The configuration for the new node.
 * @returns {SparkplugNode} The created Sparkplug node.
 */
export const createNode = (config: SparkplugCreateNodeInput): SparkplugNode => {
  const node = {
    ...config,
    bdseq: 0,
    seq: 0,
    mqtt: null,
    states: {
      connected: { born: false, dead: false },
      disconnected: true,
    },
    devices: flatten(config.devices).reduce((acc, { id, metrics }) => {
      acc[id] = createDevice(id, metrics);
      return acc;
    }, {} as { [id: string]: SparkplugDevice }),
    events: new EventEmitter(),
    scanRates: {},
  };
  return connectNode(node);
};
