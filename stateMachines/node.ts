import EventEmitter from "node:events";
import type {
  SparkplugCreateNodeInput,
  SparkplugDevice,
  SparkplugMetric,
  SparkplugNode,
  SparkplugNodeScanRates,
} from "../types.d.ts";
import { curry, pipe } from "npm:ramda@0.30.1";
import {
  createMqttClient,
  createSpbTopic,
  destroyMqttClient,
  type Modify,
  publishDeviceData,
  publishNodeBirth,
  publishNodeData,
  publishNodeDeath,
  subscribeCurry,
} from "../mqtt.ts";
import type {
  UMetric,
  UPayload,
} from "npm:sparkplug-payload@1.0.3/lib/sparkplugbpayload.js";
import { log } from "../log.ts";
import { getUnixTime } from "npm:date-fns@3.6.0";
import { someTrue } from "../utils.ts";
import { birthDevice, createDevice, killDevice } from "./device.ts";
import { setStateCurry } from "../utils.ts";
import { flatten, getMqttConfigFromSparkplug, on, onCurry } from "./utils.ts";
import type { NodeEvent, NodeTransition } from "./types.d.ts";
import { onMessage } from "./utils.ts";
import type mqtt from "npm:mqtt@5.10.1";
import type { OnConnectCallback } from "npm:mqtt@5.10.1";
import { createLogger } from "@joyautomation/coral";
import { getLogLevel } from "../log.ts";

const logRbe = createLogger("rbe", getLogLevel());
const isLogRbeEnabled = Boolean(Deno.env.get("NEURON_RBE_LOG_ENABLED")) == true;

/**
 * Handles the connection event for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to handle the connection for.
 * @returns {() => void} A function to be called when the connection is established.
 */
const onConnect = (node: SparkplugNode) => {
  return () => {
    setNodeStateConnected(node);
    log.info(
      `${node.id} connected to ${node.brokerUrl} with user ${node.username}`
    );
    node.events.emit("connected");
    birthNode(node);
    Object.values(node.devices).forEach((device) => {
      killDevice(node, device);
      birthDevice(node, device);
    });
    killScans(node);
    node.scanRates = startScans(node);
  };
};

/**
 * Handles the disconnection event for a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to handle the disconnection for.
 * @returns {() => void} A function to be called when the disconnection occurs.
 */
const onDisconnect = (node: SparkplugNode) => {
  return () => {
    setNodeStateDisconnected(node);
    log.info(`${node.id} disconnected`);
    node.events.emit("disconnected");
  };
};

/**
 * Object containing node command functions.
 */
export const nodeCommands = {
  rebirth: (node: SparkplugNode) =>
    pipe(killNode, disconnectNode, connectNode)(node),
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
  return (topic: string, message: UPayload) => {
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
      subscribeCurry(createSpbTopic("DCMD", getMqttConfigFromSparkplug(node)), {
        qos: 0,
      }),
      subscribeCurry(createSpbTopic("NCMD", getMqttConfigFromSparkplug(node)), {
        qos: 0,
      }),
      subscribeCurry("STATE/#", { qos: 1 })
    )(node.mqtt);
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
const nodeTransitions = {
  connect: (node: SparkplugNode) => {
    node.mqtt = createMqttClient(getMqttConfigFromSparkplug(node), node.bdseq);
    return setupNodeEvents(node);
  },
  disconnect: (node: SparkplugNode) => {
    destroyMqttClient(node.mqtt);
    return setNodeStateDisconnected(node);
  },
  birth: (node: SparkplugNode) => {
    if (node.mqtt)
      publishNodeBirth(
        node.bdseq,
        node.seq,
        undefined,
        getNodeBirthPayload(flatten(node.metrics)),
        getMqttConfigFromSparkplug(node),
        node.mqtt
      );
    return node;
  },
  death: (node: SparkplugNode) => {
    if (node.mqtt)
      publishNodeDeath(node.bdseq, getMqttConfigFromSparkplug(node), node.mqtt);
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
const deriveSetNodeState = (state: Partial<SparkplugNode["states"]>) =>
  pipe(
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
const changeNodeState = curry(
  (
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
  }
);

/**
 * Gets the node birth payload.
 * @param {UMetric[] | undefined} metrics - The metrics to include in the birth payload.
 * @returns {UPayload} The node birth payload.
 */
export const getNodeBirthPayload = (
  metrics: UMetric[] | undefined
): UPayload => ({
  timestamp: getUnixTime(new Date()),
  metrics: [
    {
      name: "Node Control/Rebirth",
      timestamp: getUnixTime(new Date()),
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
const birthNode: (node: SparkplugNode) => SparkplugNode = pipe(
  changeNodeState(
    (node: SparkplugNode) => node.states.connected.dead,
    "Node needs to be dead to be born",
    "birth"
  ) as Modify<SparkplugNode>,
  setNodeStateBorn as Modify<SparkplugNode>
);

/**
 * Kills a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to kill.
 * @returns {SparkplugNode} The killed node.
 */
const killNode = pipe(
  changeNodeState(
    (node: SparkplugNode) => node.states.connected.born,
    "Node needs to be born to be dead",
    "death"
  ) as Modify<SparkplugNode>,
  setNodeStateDead
);

/**
 * Connects a Sparkplug node.
 * @param {SparkplugNode} node - The Sparkplug node to connect.
 * @returns {SparkplugNode} The connected node.
 */
const connectNode = changeNodeState(
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
  changeNodeState(
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
export const setLastPublished = (
  parent: SparkplugNode | SparkplugDevice,
  metric: SparkplugMetric
) => {
  if (metric.name && metric.value)
    parent.metrics[metric.name].lastPublished = {
      timestamp: getUnixTime(new Date()),
      value: metric.value,
    };
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
const metricNeedsToPublish = (metric: SparkplugMetric) => {
  if (
    !metric.lastPublished ||
    metric.lastPublished.value == null ||
    !isNumberType(metric.type) ||
    !metric.deadband
  ) {
    if (metric.value !== metric.lastPublished?.value) {
      if (isLogRbeEnabled)
        logRbe.debug(
          `Metric ${metric.name} needs to be published, because it's value changed. ${metric.value} vs ${metric.lastPublished?.value}`
        );
      return true;
    }
  }

  const now = getUnixTime(new Date());
  const timeSinceLastPublish = now - metric.lastPublished.timestamp;
  const valueDifference = Math.abs(
    (metric.value as number) - Number(metric.lastPublished.value)
  );

  if (metric.deadband?.value && valueDifference > metric.deadband.value) {
    if (isLogRbeEnabled)
      logRbe.debug(
        `Metric ${metric.name} needs to be published, because it's value changed. ${metric.value} vs ${metric.lastPublished?.value}`
      );
    return true;
  } else if (
    metric.deadband?.maxTime &&
    timeSinceLastPublish > metric.deadband.maxTime
  ) {
    if (isLogRbeEnabled)
      logRbe.debug(
        `Metric ${metric.name} needs to be published, because it's max time has been exceeded. ${timeSinceLastPublish} sec > ${metric.deadband.maxTime} sec`
      );
    return true;
  }
  return false;
};

/**
 * Publishes metrics for a Sparkplug node and its devices.
 * @param {SparkplugNode} node - The Sparkplug node to publish metrics for.
 * @param {number} [scanRate] - The scan rate to filter metrics by.
 * @param {(metric: SparkplugMetric) => boolean} [metricSelector] - A function to select which metrics to publish.
 */
export const publishMetrics = (
  node: SparkplugNode,
  scanRate?: number,
  metricSelector: (metric: SparkplugMetric) => boolean = () => true
) => {
  const nodeMetrics = flatten(node.metrics).filter(
    (metric) => metric.scanRate === scanRate && metricNeedsToPublish(metric)
  );
  if (nodeMetrics.length > 0 && node.mqtt)
    publishNodeData(
      node,
      {
        metrics: nodeMetrics,
      },
      getMqttConfigFromSparkplug(node),
      node.mqtt
    );
  nodeMetrics.forEach((metric) => setLastPublished(node, metric));
  flatten(node.devices).forEach((device) => {
    const metrics = flatten(device.metrics).filter(
      (metric) =>
        metricSelector(metric) &&
        (scanRate == null || metric.scanRate === scanRate) &&
        metricNeedsToPublish(metric)
    );
    if (metrics.length > 0 && node.mqtt) {
      publishDeviceData(
        node,
        { metrics },
        getMqttConfigFromSparkplug(node),
        node.mqtt,
        device.id
      );
      metrics.forEach((metric) => setLastPublished(device, metric));
    }
  });
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
    if (scanRate != null)
      acc[scanRate] = setInterval(
        () => publishMetrics(node, scanRate),
        scanRate
      );
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
