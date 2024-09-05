import type EventEmitter from "node:events";
import { log } from "../log.ts";
import type { Buffer } from "node:buffer";

import type {
  SparkplugNode,
  SparkplugHost,
  ISparkplugEdgeOptions,
  ISparkplugHostOptions,
} from "../types.d.ts";
import { handleMessage } from "../mqtt.ts";

export const emit = (
  event: string,
  data: undefined | unknown,
  emitter: EventEmitter
) => emitter.emit(event, data);

export const emitCurry =
  (event: string, data?: unknown) => (emitter: EventEmitter) =>
    emitter.emit(event, data);

export const on = <T extends { on: (event: U, listener: V) => void }, U, V>(
  event: U,
  listener: V,
  emitter: T
): T => {
  log.info(`on ${event} added`);
  emitter.on(event, listener);
  return emitter;
};

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

export const onMessage = (input: SparkplugNode | SparkplugHost) => {
  return (topic: string, message: Buffer) => {
    const config =
      "groupId" in input
        ? getMqttConfigFromSparkplug(input as SparkplugNode)
        : getMqttConfigFromSparkplug(input as SparkplugHost);
    handleMessage(topic, message, input.events, config);
  };
};
