import type EventEmitter from "node:events";
import { logs } from "../log.ts";
const { main: log } = logs;
import type { Buffer } from "node:buffer";

import type {
  ISparkplugEdgeOptions,
  ISparkplugHostOptions,
  SparkplugHost,
  SparkplugMetric,
  SparkplugNode,
} from "../types.ts";
import { handleMessage } from "../mqtt.ts";
import { getUnixTime } from "date-fns";

/**
 * Emits an event with optional data using the provided EventEmitter.
 * @param event - The name of the event to emit
 * @param data - Optional data to pass with the event
 * @param emitter - The EventEmitter instance to use
 */
export const emit = (
  event: string,
  data: undefined | unknown,
  emitter: EventEmitter
) => emitter.emit(event, data);

/**
 * Creates a curried function for emitting an event with optional data.
 * @param event - The name of the event to emit
 * @param data - Optional data to pass with the event
 * @returns A function that takes an EventEmitter and emits the event
 */
export const emitCurry =
  (event: string, data?: unknown) => (emitter: EventEmitter) =>
    emitter.emit(event, data);

/**
 * Adds an event listener to the provided emitter and returns the emitter.
 * @param event - The event to listen for
 * @param listener - The callback function to execute when the event is emitted
 * @param emitter - The object with the 'on' method for adding event listeners
 * @returns The emitter object
 */
export const on = <T extends { on: (event: U, listener: V) => void }, U, V>(
  event: U,
  listener: V,
  emitter: T
): T => {
  log.debug(`on ${event} added`);
  emitter.on(event, listener);
  return emitter;
};

/**
 * Creates a curried function for adding an event listener to an emitter.
 * @param event - The event to listen for
 * @param listener - The callback function to execute when the event is emitted
 * @returns A function that takes an emitter and adds the event listener
 */
export const onCurry =
  <T extends { on: (event: U, listener: V) => void }, U, V>(
    event: U,
    listener: V
  ) =>
  (emitter: T): T =>
    on(event, listener, emitter);

/**
 * Retrieves the MQTT configuration from a Sparkplug Node or Host object.
 * This function uses function overloading to handle different input types:
 *
 * 1. When given a SparkplugNode, it returns an ISparkplugEdgeOptions object.
 * 2. When given a SparkplugHost, it returns an ISparkplugHostOptions object.
 *
 * The function extracts common configuration properties and then adds
 * type-specific properties based on the input object's structure.
 *
 * If the input doesn't match either expected type, it throws an error.
 *
 * @param input - Either a SparkplugNode or SparkplugHost object
 * @returns Either ISparkplugEdgeOptions or ISparkplugHostOptions
 * @throws Error if the input type is invalid
 */

export function getMqttConfigFromSparkplug(
  input: SparkplugNode
): ISparkplugEdgeOptions;
export function getMqttConfigFromSparkplug(
  input: SparkplugHost
): ISparkplugHostOptions;
export function getMqttConfigFromSparkplug(
  input: SparkplugNode | SparkplugHost
): ISparkplugEdgeOptions | ISparkplugHostOptions {
  const commonConfig = {
    clientId: input.clientId,
    serverUrl: input.brokerUrl,
    username: input.username,
    password: input.password,
    version: input.version,
    keepalive: input.keepalive,
    mqttOptions: input.mqttOptions,
  };

  if ("groupId" in input && "id" in input) {
    return {
      ...commonConfig,
      groupId: input.groupId,
      edgeNode: input.id,
    };
  } else if ("primaryHostId" in input) {
    return {
      ...commonConfig,
      primaryHostId: input.primaryHostId,
    };
  }

  // This should never happen if types are correct, but it's good practice
  throw new Error("Invalid input type");
}

/**
 * Creates a message handler function for MQTT messages.
 * @param input - Either a SparkplugNode or SparkplugHost object
 * @returns A function that handles incoming MQTT messages
 */
export const onMessage = (input: SparkplugNode | SparkplugHost) => {
  return (topic: string, message: Buffer) => {
    const config =
      "groupId" in input
        ? getMqttConfigFromSparkplug(input as SparkplugNode)
        : getMqttConfigFromSparkplug(input as SparkplugHost);
    handleMessage(topic, message, input.events, config);
  };
};

/**
 * Flattens an object into an array of objects, adding an 'id' property to each.
 *
 * @template T - The type of the values in the input object.
 * @param {Object.<string, T>} obj - The input object to flatten.
 * @returns {Array.<{id: string} & T>} An array of objects, each containing an 'id' property and the properties of the original object's value.
 *
 * @example
 * const input = { foo: { bar: 1 }, baz: { qux: 2 } };
 * const result = flatten(input);
 * // Result: [{ id: 'foo', bar: 1 }, { id: 'baz', qux: 2 }]
 */
export const flatten = <T>(obj: Record<string, T>) => {
  return Object.entries(obj).map(([key, value]) => ({
    ...value,
    id: key,
    name: key,
  }));
};

export const unflatten = <
  T extends { id?: string | null; name?: string | null }
>(
  arr?: T[] | null
): { [key: string]: T } => {
  if (!arr) {
    return {};
  }
  return arr.reduce((acc, item) => {
    const id = item.id ?? item.name;
    if (id) {
      acc[id] = item;
    }
    return acc;
  }, {} as { [key: string]: T });
};

export const evaluateMetricValue = (metric: SparkplugMetric) => {
  if (typeof metric.value === "function") {
    return metric.value();
  }
  return metric.value;
};

export const evaluateMetric = async (metric: SparkplugMetric) => {
  return {
    ...metric,
    value: await evaluateMetricValue(metric),
    timestamp: getUnixTime(new Date()),
  };
};

export const evaluateMetrics = async (metrics: {
  [key: string]: SparkplugMetric;
}) => {
  return await Promise.all(Object.values(metrics).map(evaluateMetric));
};
