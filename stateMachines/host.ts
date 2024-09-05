import EventEmitter from "node:events";
import { SparkplugCreateHostInput, SparkplugHost } from "../types.d.ts";
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

export const onDisconnect = (host: SparkplugHost) => {
  return () => {
    setHostStateDisconnected(host);
    log.info(`${host.id} disconnected`);
    host.events.emit("disconnected");
  };
};

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

const hostTransitions = {
  connect: (host: SparkplugHost) => {
    host.mqtt = createHostMqttClient(getMqttConfigFromSparkplug(host));
    return setupHostEvents(host);
  },
  disconnect: (host: SparkplugHost) => {
    destroyMqttClient(host.mqtt);
    return setHostStateDisconnected(host);
  },
};

export const getHostStateString = (host: SparkplugHost) => {
  if (host.states.disconnected) {
    return "disconnected";
  } else if (host.states.connected) {
    return "born";
  } else {
    return `unknown state: ${JSON.stringify(host.states)}`;
  }
};

const resetHostState = (node: SparkplugHost) => {
  node.states = {
    connected: false,
    disconnected: false,
  };
  return node;
};

const deriveSetHostState = (state: Partial<SparkplugHost["states"]>) =>
  pipe(resetHostState, setState(state));
const setHostStateConnected = deriveSetHostState({ connected: true });
const setHostStateDisconnected = deriveSetHostState({ disconnected: true });

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

const connectHost = changeHostState(
  (host: SparkplugHost) => host.states.disconnected,
  "Host needs to be disconnected to be connected",
  "connect"
);

export const disconnectHost: (host: SparkplugHost) => SparkplugHost =
  changeHostState(
    (host: SparkplugHost) => host.states.connected,
    "Host needs to be connected to be disconnected",
    "disconnect"
  );

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
