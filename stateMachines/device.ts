import EventEmitter from "node:events";
import { pipe, pipeAsync } from "@joyautomation/dark-matter";
import type { UPayload } from "sparkplug-payload/lib/sparkplugbpayload.js";
import { logs } from "../log.ts";
const { main: log } = logs;
import {
  publishDeviceBirth,
  publishDeviceData as publishMqttDeviceData,
  publishDeviceDeath,
} from "../mqtt.ts";
import { getNodeStateString } from "./node.ts";
import type {
  SparkplugDevice,
  SparkplugMetric,
  SparkplugNode,
} from "../types.ts";
import { setStateCurry as setState } from "../utils.ts";
import { evaluateMetrics, getMqttConfigFromSparkplug } from "./utils.ts";

/**
 * Creates a new SparkplugDevice object.
 * @param {string} id - The unique identifier for the device.
 * @param {Object.<string, SparkplugMetric>} [metrics={}] - The metrics associated with the device.
 * @returns {SparkplugDevice} A new SparkplugDevice object.
 */
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
  ) => Promise<SparkplugDevice>;
};

/**
 * Derives a transition function for device birth or death.
 * @param {DeviceTransition} transition - The type of transition ('birth' or 'death').
 * @returns {function} A function that executes the specified transition.
 */
const deriveTransition =
  (transition: "birth" | "death") =>
  async (node: SparkplugNode, device: SparkplugDevice) => {
    const executeTransition =
      transition === "birth" ? publishDeviceBirth : publishDeviceDeath;
    if (node.mqtt) {
      executeTransition(
        node,
        { metrics: await evaluateMetrics(device.metrics) },
        getMqttConfigFromSparkplug(node),
        node.mqtt,
        device.id
      );
    }
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

/**
 * Gets the current state of the device as a string.
 * @param {SparkplugDevice} device - The device to check.
 * @returns {string} A string representing the current state of the device.
 */
export const getDeviceStateString = (device: SparkplugDevice) => {
  if (device.states.born) {
    return "born";
  } else if (device.states.dead) {
    return "dead";
  } else {
    return `unknown state: ${JSON.stringify(device.states)}`;
  }
};

/**
 * Changes the device state if it meets the required conditions.
 * @param {function} inRequiredState - Function to check if the device is in the required state.
 * @param {string} notInRequiredStateLogText - Log message if the device is not in the required state.
 * @param {DeviceTransition} transition - The type of transition to perform.
 * @param {SparkplugNode} node - The node associated with the device.
 * @param {SparkplugDevice} device - The device to change state.
 * @returns {SparkplugDevice} The updated device object.
 */
const changeDeviceState = async (
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
    await deviceTransitions[transition](node, device);
  }
  return device;
};

const changeDeviceStateCurry =
  (
    inRequiredState: (device: SparkplugDevice) => boolean,
    notInRequiredStateLogText: string,
    transition: DeviceTransition,
    node: SparkplugNode
  ) =>
  (device: SparkplugDevice) =>
    changeDeviceState(
      inRequiredState,
      notInRequiredStateLogText,
      transition,
      node,
      device
    );

/**
 * Resets the device state to its initial values.
 * @param {SparkplugDevice} device - The device to reset.
 * @returns {SparkplugDevice} The updated device object.
 */
const resetDeviceState = (device: SparkplugDevice) => {
  device.states = {
    born: false,
    dead: false,
  };
  return device;
};

/**
 * Derives a function to set a specific device state.
 * @param {Partial<SparkplugDevice["states"]>} state - The state to set.
 * @returns {function} A function that sets the specified state.
 */
const deriveSetDeviceState =
  (state: Partial<SparkplugDevice["states"]>) => (device: SparkplugDevice) =>
    pipe(device, resetDeviceState, setState(state));

/**
 * Sets the device state to 'born'.
 * @param {SparkplugDevice} device - The device to update.
 * @returns {SparkplugDevice} The updated device object.
 */
const setDeviceStateBorn = deriveSetDeviceState({ born: true });

/**
 * Sets the device state to 'dead'.
 * @param {SparkplugDevice} device - The device to update.
 * @returns {SparkplugDevice} The updated device object.
 */
const setDeviceStateDead = deriveSetDeviceState({ dead: true });

/**
 * Transitions a device to the "born" state.
 * @param {SparkplugNode} node - The node associated with the device.
 * @param {SparkplugDevice} device - The device to transition.
 * @returns {SparkplugDevice} The updated device object.
 */
export const birthDevice = (node: SparkplugNode, device: SparkplugDevice) =>
  pipeAsync(
    device,
    changeDeviceStateCurry(
      (device: SparkplugDevice) => device.states.dead,
      "Device needs to be dead to be born",
      "birth",
      node
    ),
    setDeviceStateBorn
  );

/**
 * Transitions a device to the "dead" state.
 * @param {SparkplugNode} node - The node associated with the device.
 * @param {SparkplugDevice} device - The device to transition.
 * @returns {SparkplugDevice} The updated device object.
 */
export const killDevice = (node: SparkplugNode, device: SparkplugDevice) =>
  pipeAsync(
    device,
    changeDeviceStateCurry(
      (device: SparkplugDevice) => device.states.born,
      "Device needs to be born to be dead",
      "death",
      node
    ),
    setDeviceStateDead
  );

/**
 * Publishes device data if the node and device are in the correct states.
 * @param {SparkplugNode} node - The node associated with the device.
 * @param {SparkplugDevice} device - The device publishing the data.
 * @param {UPayload} payload - The data payload to publish.
 * @returns {SparkplugDevice} The device object.
 */
export const publishDeviceData = (
  node: SparkplugNode,
  device: SparkplugDevice,
  payload: UPayload
) => {
  if (node.states.connected.born) {
    if (device.states.born) {
      if (node.mqtt) {
        publishMqttDeviceData(
          node,
          payload,
          getMqttConfigFromSparkplug(node),
          node.mqtt,
          device.id
        );
      }
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