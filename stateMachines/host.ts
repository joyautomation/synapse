import EventEmitter from "node:events";
import type { SparkplugCreateHostInput, SparkplugHost } from "../types.d.ts";
import { curry, pipe } from "npm:ramda@0.30.1";
import { log } from "../log.ts";
import {
  createHostMqttClient,
  destroyMqttClient,
  publishHostOnline,
  subscribeCurry,
} from "../mqtt.ts";
import type mqtt from "npm:mqtt@5.10.1";
import { setStateCurry as setState } from "../utils.ts";
import type { HostTransition } from "./types.d.ts";
import { getMqttConfigFromSparkplug, onCurry } from "./utils.ts";
import { onMessage } from "./utils.ts";

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
      `${host.id} connected to ${host.brokerUrl} with user ${host.username}`
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
        onConnect(host)
      ),
      onCurry<mqtt.MqttClient, "message", mqtt.OnMessageCallback>(
        "message",
        onMessage(host)
      ),
      onCurry<mqtt.MqttClient, "disconnect", mqtt.OnDisconnectCallback>(
        "disconnect",
        onDisconnect(host)
      ),
      subscribeCurry("STATE/#", { qos: 1 }),
      subscribeCurry(`${host.version}/#`, { qos: 0 })
    )(host.mqtt);
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
    host: SparkplugHost
  ) => {
    if (!inRequiredState(host)) {
      log.info(
        `${notInRequiredStateLogText}, it is currently: ${getHostStateString(
          host
        )}`
      );
    } else {
      log.info(
        `transitioning from ${getHostStateString(host)} to ${transition}`
      );
      hostTransitions[transition](host);
    }
    return host;
  }
);

/**
 * Connects a SparkplugHost if it's currently disconnected.
 * @param {SparkplugHost} host - The SparkplugHost instance to connect.
 * @returns {SparkplugHost} The updated SparkplugHost instance.
 */
const connectHost = changeHostState(
  (host: SparkplugHost) => host.states.disconnected,
  "Host needs to be disconnected to be connected",
  "connect"
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
    "disconnect"
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
  };
  return connectHost(host);
};
