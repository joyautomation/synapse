import EventEmitter from "node:events";
import type { SparkplugCreateHostInput, SparkplugHost } from "../types.d.ts";
import { curry, pipe } from "ramda";
import { log } from "../log.ts";
import {
  createHostMqttClient,
  destroyMqttClient,
  publishHostOnline,
  publishNodeCommand,
  SpbTopic,
  subscribeCurry,
} from "../mqtt.ts";
import type mqtt from "mqtt";
import { cond, setStateCurry as setState } from "../utils.ts";
import type { HostTransition } from "./types.d.ts";
import {
  flatten,
  getMqttConfigFromSparkplug,
  onCurry,
  unflatten,
} from "./utils.ts";
import { onMessage } from "./utils.ts";
import type {
  UMetric,
  UPayload,
} from "sparkplug-payload/lib/sparkplugbpayload.js";

/**
 * Handles the 'connect' event for a SparkplugHost.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @returns {() => void} A function to be called when the host connects.
 */
export const onConnect = (host: SparkplugHost) => {
  return () => {
    setHostStateConnected(host);
    publishHostOnline(host);
    log.info(
      `${host.id} connected to ${host.brokerUrl} with user ${host.username}`,
    );
    host.events.emit("connected");
  };
};

/**
 * Handles the 'disconnect' event for a SparkplugHost.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @returns {() => void} A function to be called when the host disconnects.
 */
export const onDisconnect = (host: SparkplugHost) => {
  return () => {
    setHostStateDisconnected(host);
    log.info(`${host.id} disconnected`);
    host.events.emit("disconnected");
  };
};

/**
 * Sets up event listeners for a SparkplugHost.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 */
const setupHostEvents = (host: SparkplugHost) => {
  if (host.mqtt) {
    pipe(
      onCurry<mqtt.MqttClient, "connect", mqtt.OnConnectCallback>(
        "connect",
        onConnect(host),
      ),
      onCurry<mqtt.MqttClient, "message", mqtt.OnMessageCallback>(
        "message",
        onMessage(host),
      ),
      onCurry<mqtt.MqttClient, "disconnect", mqtt.OnDisconnectCallback>(
        "disconnect",
        onDisconnect(host),
      ),
      subscribeCurry("STATE/#", { qos: 1 }),
      subscribeCurry(`${host.version}/#`, { qos: 0 }),
    )(host.mqtt);
    createHostMessageEvents(host);
  }
};

/**
 * Defines the state transitions for a SparkplugHost.
 */
const hostTransitions = {
  /**
   * Connects the host to the MQTT broker.
   * @param {SparkplugHost} host - The SparkplugHost instance.
   * @returns {void}
   */
  connect: (host: SparkplugHost) => {
    host.mqtt = createHostMqttClient(getMqttConfigFromSparkplug(host));
    return setupHostEvents(host);
  },
  /**
   * Disconnects the host from the MQTT broker.
   * @param {SparkplugHost} host - The SparkplugHost instance.
   * @returns {SparkplugHost} The updated SparkplugHost instance.
   */
  disconnect: (host: SparkplugHost) => {
    destroyMqttClient(host.mqtt);
    return setHostStateDisconnected(host);
  },
};

/**
 * Gets the current state of a SparkplugHost as a string.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @returns {string} The current state as a string.
 */
export const getHostStateString = (host: SparkplugHost) => {
  if (host.states.disconnected) {
    return "disconnected";
  } else if (host.states.connected) {
    return "born";
  } else {
    return `unknown state: ${JSON.stringify(host.states)}`;
  }
};

/**
 * Resets the state of a SparkplugHost.
 * @param {SparkplugHost} node - The SparkplugHost instance to reset.
 * @returns {SparkplugHost} The reset SparkplugHost instance.
 */
const resetHostState = (node: SparkplugHost) => {
  node.states = {
    connected: false,
    disconnected: false,
  };
  return node;
};

/**
 * Derives a function to set a specific state for a SparkplugHost.
 * @param {Partial<SparkplugHost["states"]>} state - The state to set.
 * @returns {(host: SparkplugHost) => SparkplugHost} A function that sets the specified state.
 */
const deriveSetHostState = (state: Partial<SparkplugHost["states"]>) =>
  pipe(resetHostState, setState(state));

/**
 * Sets the host state to connected.
 * @type {(host: SparkplugHost) => SparkplugHost}
 */
const setHostStateConnected = deriveSetHostState({ connected: true });

/**
 * Sets the host state to disconnected.
 * @type {(host: SparkplugHost) => SparkplugHost}
 */
const setHostStateDisconnected = deriveSetHostState({ disconnected: true });

/**
 * Changes the state of a SparkplugHost if it meets the required conditions.
 * @param {(host: SparkplugHost) => boolean} inRequiredState - Function to check if the host is in the required state.
 * @param {string} notInRequiredStateLogText - Log message if the host is not in the required state.
 * @param {HostTransition} transition - The transition to perform.
 * @param {SparkplugHost} host - The SparkplugHost instance.
 * @returns {SparkplugHost} The updated SparkplugHost instance.
 */
const changeHostState = curry(
  (
    inRequiredState: (host: SparkplugHost) => boolean,
    notInRequiredStateLogText: string,
    transition: HostTransition,
    host: SparkplugHost,
  ) => {
    if (!inRequiredState(host)) {
      log.info(
        `${notInRequiredStateLogText}, it is currently: ${
          getHostStateString(
            host,
          )
        }`,
      );
    } else {
      log.info(
        `Host ${host.id} transitioning from ${
          getHostStateString(
            host,
          )
        } to ${transition}`,
      );
      hostTransitions[transition](host);
    }
    return host;
  },
);

/**
 * Connects a SparkplugHost if it's currently disconnected.
 * @param {SparkplugHost} host - The SparkplugHost instance to connect.
 * @returns {SparkplugHost} The updated SparkplugHost instance.
 */
const connectHost = changeHostState(
  (host: SparkplugHost) => host.states.disconnected,
  "Host needs to be disconnected to be connected",
  "connect",
);

/**
 * Disconnects a SparkplugHost if it's currently connected.
 * @param {SparkplugHost} host - The SparkplugHost instance to disconnect.
 * @returns {SparkplugHost} The updated SparkplugHost instance.
 */
export const disconnectHost: (host: SparkplugHost) => SparkplugHost =
  changeHostState(
    (host: SparkplugHost) => host.states.connected,
    "Host needs to be connected to be disconnected",
    "disconnect",
  );

/**
 * Creates a new SparkplugHost instance and connects it.
 * @param {SparkplugCreateHostInput} config - The configuration for the new host.
 * @returns {SparkplugHost} The newly created and connected SparkplugHost instance.
 */
export const createHost = (config: SparkplugCreateHostInput): SparkplugHost => {
  const host = {
    ...config,
    bdseq: 0,
    seq: 0,
    mqtt: null,
    states: {
      connected: false,
      disconnected: true,
    },
    events: new EventEmitter(),
    scanRates: {},
    primaryHostId: config.primaryHostId,
    groups: {},
  };
  return connectHost(host);
};

type dataEvent = "nbirth" | "dbirth" | "ndata" | "ddata";

type DataEventConditionArgs = {
  event: dataEvent;
  host: SparkplugHost;
  topic: SpbTopic;
  message: UPayload;
};

const updateHostMetric = ({
  host,
  topic,
  message,
}: DataEventConditionArgs) => {
  const { groupId, edgeNode, deviceId } = topic;
  message.metrics?.forEach((metric: UMetric) => {
    if (deviceId) {
      if (!host.groups[groupId]?.nodes[edgeNode]) {
        publishNodeRebirthRequest(host, topic);
      } else {
        if (metric.name) {
          host.groups[groupId].nodes[edgeNode].devices[deviceId]
            .metrics[metric.name] = metric;
        }
      }
    } else {
      if (!host.groups[groupId]?.nodes[edgeNode]) {
        publishNodeRebirthRequest(host, topic);
      } else {
        if (metric.name) {
          host.groups[groupId].nodes[edgeNode].metrics[metric.name] = metric;
        }
      }
    }
  });
};

export const flattenHostGroups = (host: SparkplugHost) => {
  return flatten(host.groups).map((group) => ({
    ...group,
    nodes: flatten(group.nodes).map((node) => ({
      ...node,
      devices: flatten(node.devices).map((device) => ({
        ...device,
        metrics: flatten(device.metrics),
      })),
      metrics: flatten(node.metrics),
    })),
  }));
};

const createHostNode = ({
  host,
  topic,
  message,
}: DataEventConditionArgs) => {
  const { groupId, edgeNode } = topic;
  host.groups[groupId] = {
    id: groupId,
    nodes: {
      [edgeNode]: {
        id: edgeNode,
        metrics: unflatten(message.metrics),
        devices: {},
      },
    },
  };
  updateHostMetric({ event: "nbirth", host, topic, message });
};

const createHostDevice = ({
  host,
  topic,
  message,
}: DataEventConditionArgs) => {
  const { groupId, edgeNode, deviceId } = topic;
  if (deviceId) {
    if (!host.groups[groupId]?.nodes[edgeNode]) {
      publishNodeRebirthRequest(host, topic);
    } else {
      host.groups[groupId].nodes[edgeNode].devices[deviceId] = {
        id: deviceId,
        metrics: unflatten(message.metrics),
      };
    }
  }
  updateHostMetric({ event: "dbirth", host, topic, message });
};

/**
 * Publishes a rebirth request to a specific node.
 *
 * This function sends a command to a node to initiate a rebirth process.
 * It only executes if the host has an active MQTT connection.
 *
 * @param {SparkplugHost} host - The Sparkplug host object.
 * @param {SpbTopic} topic - The Sparkplug topic object containing groupId and edgeNode.
 */
const publishNodeRebirthRequest = (
  host: SparkplugHost,
  topic: SpbTopic,
) => {
  if (host.mqtt) {
    publishNodeCommand(
      host,
      "Rebirth",
      true,
      topic.groupId,
      topic.edgeNode,
      getMqttConfigFromSparkplug(host),
      host.mqtt,
    );
  }
};

/**
 * Array of conditions and actions for handling different data events.
 * Each condition is checked against the event type, and the corresponding action is executed if the condition is met.
 */
const dataEventConditions = [
  {
    condition: ({ event }: DataEventConditionArgs) => event === "nbirth",
    action: createHostNode,
  },
  {
    condition: ({ event }: DataEventConditionArgs) => event === "dbirth",
    action: createHostDevice,
  },
  {
    condition: ({ event }: DataEventConditionArgs) =>
      event === "ndata" || event === "ddata",
    action: updateHostMetric,
  },
];

/**
 * Creates a function to process a specific data event for a given host.
 *
 * @param {SparkplugHost} host - The Sparkplug host object.
 * @param {("nbirth" | "dbirth" | "ndata" | "ddata")} event - The type of event to process.
 * @returns {(topic: SpbTopic, message: UPayload) => void} A function that processes the event.
 */
const processDataEvent =
  (host: SparkplugHost, event: "nbirth" | "dbirth" | "ndata" | "ddata") =>
  (topic: SpbTopic, message: UPayload) => {
    try {
      cond<
        {
          event: dataEvent;
          host: SparkplugHost;
          topic: SpbTopic;
          message: UPayload;
        },
        void
      >(
        { event, host, topic, message },
        dataEventConditions,
      );
    } catch (error) {
      log.error(error.stack);
    }
  };

/**
 * Sets up event listeners for various Sparkplug message types on the host.
 *
 * @param {SparkplugHost} host - The Sparkplug host object to set up events for.
 */
export const createHostMessageEvents = (host: SparkplugHost) => {
  ["nbirth", "dbirth", "ndata", "ddata"].forEach((event) => {
    host.events.on(
      event,
      processDataEvent(host, event as "nbirth" | "dbirth" | "ndata" | "ddata"),
    );
  });
};
