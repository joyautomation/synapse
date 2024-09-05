import EventEmitter from "node:events";
import { curry, pipe } from "npm:ramda@0.30.1";
import type { UPayload } from "npm:sparkplug-payload/lib/sparkplugbpayload.js";
import { log } from "../log.ts";
import {
  type Modify,
  publishDeviceBirth,
  publishDeviceDeath,
  publishDeviceData as publishMqttDeviceData,
} from "../mqtt.ts";
import { getNodeStateString } from "./node.ts";
import type {
  SparkplugDevice,
  SparkplugMetric,
  SparkplugNode,
} from "../types.d.ts";
import { setStateCurry as setState } from "../utils.ts";
import { getMqttConfigFromSparkplug } from "./utils.ts";

export const createDevice = (
  id: string,
  metrics: { [id: string]: SparkplugMetric } = {}
): SparkplugDevice => ({
  id,
  metrics,
  states: {
    born: false,
    dead: true,
  },
  events: new EventEmitter(),
});

type DeviceTransition = "birth" | "death";
type DeviceTransitions = {
  [K in DeviceTransition]: (
    node: SparkplugNode,
    device: SparkplugDevice
  ) => SparkplugDevice;
};

const deriveTransition =
  (transition: "birth" | "death") =>
  (node: SparkplugNode, device: SparkplugDevice) => {
    const executeTransition =
      transition === "birth" ? publishDeviceBirth : publishDeviceDeath;
    if (node.mqtt)
      executeTransition(
        node,
        { metrics: Object.values(device.metrics) },
        getMqttConfigFromSparkplug(node),
        node.mqtt,
        device.id
      );
    return device;
  };

const deviceTransitionNames: DeviceTransition[] = ["birth", "death"];

const deviceTransitions = deviceTransitionNames.reduce(
  (acc: DeviceTransitions, transition) => {
    acc[transition] = (node: SparkplugNode, device: SparkplugDevice) => {
      return deriveTransition(transition)(node, device);
    };
    return acc;
  },
  {} as DeviceTransitions
);

export const getDeviceStateString = (device: SparkplugDevice) => {
  if (device.states.born) {
    return "born";
  } else if (device.states.dead) {
    return "dead";
  } else {
    return `unknown state: ${JSON.stringify(device.states)}`;
  }
};

const changeDeviceState = curry(
  (
    inRequiredState: (device: SparkplugDevice) => boolean,
    notInRequiredStateLogText: string,
    transition: DeviceTransition,
    node: SparkplugNode,
    device: SparkplugDevice
  ) => {
    if (!inRequiredState(device)) {
      log.info(
        `${notInRequiredStateLogText}, it is currently: ${getDeviceStateString(
          device
        )}`
      );
    } else {
      log.info(
        `transitioning from ${getDeviceStateString(device)} to ${transition}`
      );
      deviceTransitions[transition](node, device);
    }
    return device;
  }
);

const resetDeviceState = (device: SparkplugDevice) => {
  device.states = {
    born: false,
    dead: false,
  };
  return device;
};

const deriveSetDeviceState = (state: Partial<SparkplugDevice["states"]>) =>
  pipe(resetDeviceState, setState(state));
const setDeviceStateBorn = deriveSetDeviceState({ born: true });
const setDeviceStateDead = deriveSetDeviceState({ dead: true });

export const birthDevice = (node: SparkplugNode, device: SparkplugDevice) =>
  pipe(
    changeDeviceState(
      (device: SparkplugDevice) => device.states.dead,
      "Device needs to be dead to be born",
      "birth",
      node
    ) as Modify<SparkplugDevice>,
    setDeviceStateBorn
  )(device);

export const killDevice = (node: SparkplugNode, device: SparkplugDevice) =>
  pipe(
    changeDeviceState(
      (device: SparkplugDevice) => device.states.born,
      "Device needs to be born to be dead",
      "death",
      node
    ) as Modify<SparkplugDevice>,
    setDeviceStateDead
  )(device);

export const publishDeviceData = (
  node: SparkplugNode,
  device: SparkplugDevice,
  payload: UPayload
) => {
  if (node.states.connected.born) {
    if (device.states.born) {
      if (node.mqtt)
        publishMqttDeviceData(
          node,
          payload,
          getMqttConfigFromSparkplug(node),
          node.mqtt,
          device.id
        );
    } else {
      log.info(
        `Cannot publish data to device ${node.id}/${
          device.id
        } because the device state is currently ${getDeviceStateString(device)}`
      );
    }
  } else {
    log.info(
      `Cannot publish data to device ${node.id}/${
        device.id
      } because the node state is currently ${getNodeStateString(node)}`
    );
  }
  return device;
};
