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
import { getMqttConfigFromSparkplug, on, onCurry } from "./utils.ts";
import type { NodeEvent, NodeTransition } from "./types.d.ts";
import { onMessage } from "./utils.ts";
import type mqtt from "npm:mqtt@5.10.1";
import type { OnConnectCallback } from "npm:mqtt@5.10.1";

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
        getNodeBirthPayload(Object.values(node.metrics)),
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
        `transitioning from ${getNodeStateString(node)} to ${transition}`
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
  const nodeMetrics = Object.values(node.metrics).filter(
    (metric) => metric.scanRate === scanRate
  );
  if (nodeMetrics.length > 0 && node.mqtt)
    publishNodeData(
      node,
      {
        metrics: Object.values(node.metrics).filter(
          (metric) =>
            metricSelector(metric) &&
            (scanRate == null || metric.scanRate === scanRate)
        ),
      },
      getMqttConfigFromSparkplug(node),
      node.mqtt
    );
  Object.values(node.devices).forEach((device) => {
    const metrics = Object.values(device.metrics).filter(
      (metric) =>
        metricSelector(metric) &&
        (scanRate == null || metric.scanRate === scanRate)
    );
    if (metrics.length > 0 && node.mqtt) {
      publishDeviceData(
        node,
        { metrics },
        getMqttConfigFromSparkplug(node),
        node.mqtt,
        device.id
      );
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
        ...Object.values(node.metrics),
        ...Object.values(node.devices).reduce(
          (acc, devices) => acc.concat(Object.values(devices.metrics)),
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
    devices: Object.values(config.devices).reduce((acc, { id, metrics }) => {
      acc[id] = createDevice(id, metrics);
      return acc;
    }, {} as { [id: string]: SparkplugDevice }),
    events: new EventEmitter(),
    scanRates: {},
  };
  return connectNode(node);
};
