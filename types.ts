import type { IClientOptions } from "mqtt";
import type mqtt from "mqtt";
import type { UMetric } from "sparkplug-payload/lib/sparkplugbpayload.js";
import type { EventEmitter } from "node:events";
import type { PayloadOptions as CompressionPayloadOptions } from "./compression/types.ts";

/**
 * Represents the type of Sparkplug client.
 * @typedef {("host" | "edge")} SparkplugClientType
 */
export type SparkplugClientType = "host" | "edge";

/**
 * Represents an event listener function.
 * @typedef {Function} EventListener
 * @param {...unknown} args - The arguments passed to the event listener.
 * @returns {void}
 */
export type EventListener = (...args: unknown[]) => void;

/**
 * Interface for base Sparkplug options.
 * @interface ISparkplugBaseOptions
 */
export interface ISparkplugBaseOptions {
  /** The URL of the MQTT server. */
  serverUrl: string;
  /** The username for MQTT authentication. */
  username: string;
  /** The password for MQTT authentication. */
  password: string;
  /** The client ID for the MQTT connection. */
  clientId: string;
  /** Whether to publish a death certificate. */
  publishDeath?: boolean;
  /** The version of the Sparkplug protocol. */
  version?: string;
  /** The keepalive interval in seconds. */
  keepalive?: number;
  /** Additional MQTT options. */
  mqttOptions?: Omit<
    IClientOptions,
    | "clientId"
    | "clean"
    | "keepalive"
    | "reschedulePings"
    | "connectTimeout"
    | "username"
    | "password"
    | "will"
  >;
}

/**
 * Interface for Sparkplug Edge options.
 * @interface ISparkplugEdgeOptions
 * @extends {ISparkplugBaseOptions}
 */
export interface ISparkplugEdgeOptions extends ISparkplugBaseOptions {
  /** The group ID for the Edge node. */
  groupId: string;
  /** The Edge node identifier. */
  edgeNode: string;
}

/**
 * Interface for Sparkplug Host options.
 * @interface ISparkplugHostOptions
 * @extends {ISparkplugBaseOptions}
 */
export interface ISparkplugHostOptions extends ISparkplugBaseOptions {
  /** The primary host identifier. */
  primaryHostId: string;
}

/** @internal */
export type PayloadOptions = CompressionPayloadOptions;

/**
 * Interface for creating a base Sparkplug input.
 * @interface SparkplugCreateBaseInput
 */
export interface SparkplugCreateBaseInput {
  /** The client ID for the MQTT connection. */
  clientId: string;
  /** The URL of the MQTT broker. */
  brokerUrl: string;
  /** The username for MQTT authentication. */
  username: string;
  /** The password for MQTT authentication. */
  password: string;
  /** The identifier for the Sparkplug entity. */
  id: string;
  /** The version of the Sparkplug protocol. */
  version?: string;
  /** The keepalive interval in seconds. */
  keepalive?: number;
  /** Options for payload compression. */
  payloadOptions?: PayloadOptions;
  /** Additional MQTT options. */
  mqttOptions?: Omit<
    IClientOptions,
    | "clientId"
    | "clean"
    | "keepalive"
    | "reschedulePings"
    | "connectTimeout"
    | "username"
    | "password"
    | "will"
  >;
}

/**
 * Interface for creating a Sparkplug Node input.
 * @interface SparkplugCreateNodeInput
 * @extends {SparkplugCreateBaseInput}
 */
export interface SparkplugCreateNodeInput extends SparkplugCreateBaseInput {
  /** The group ID for the Node. */
  groupId: string;
  /** The metrics associated with the Node. */
  metrics: {
    [id: string]: SparkplugMetric;
  };
  /** The devices associated with the Node. */
  devices: {
    [id: string]: SparkplugCreateDeviceInput;
  };
}

/**
 * Interface for Sparkplug Node scan rates.
 * @interface SparkplugNodeScanRates
 */
export interface SparkplugNodeScanRates {
  /**
   * Maps scan rate intervals (in milliseconds) to their corresponding timer handles
   * @type {ReturnType<typeof setInterval>}
   */
  [key: number]: ReturnType<typeof setInterval>;
}

/**
 * Interface for base Sparkplug entity.
 * @interface SparkplugBase
 * @extends {SparkplugCreateBaseInput}
 */
export interface SparkplugBase extends SparkplugCreateBaseInput {
  /** The birth/death sequence number. */
  bdseq: number;
  /** The sequence number. */
  seq: number;
  /** The MQTT client instance. */
  mqtt: mqtt.MqttClient | null;
  /** The connection states. */
  states: {
    connected: boolean;
    disconnected: boolean;
  };
  /** The event emitter for the Sparkplug entity. */
  events: EventEmitter;
}

/**
 * Interface for creating a Sparkplug Host input.
 * @interface SparkplugCreateHostInput
 * @extends {SparkplugCreateBaseInput}
 */
export interface SparkplugCreateHostInput extends SparkplugCreateBaseInput {
  /** The primary host identifier. */
  primaryHostId: string;
}

/**
 * Interface for a Sparkplug Host.
 * @interface SparkplugHost
 * @extends {SparkplugBase}
 */
export interface SparkplugHost extends SparkplugBase {
  /** The primary host identifier. */
  primaryHostId: string;
  /** The groups associated with the Host. */
  groups: {
    [groupId: string]: SparkplugGroup;
  };
}

/**
 * Interface for a Sparkplug Group.
 * @interface SparkplugGroup
 */
export interface SparkplugGroup {
  /** The group identifier. */
  id: string;
  /** The nodes associated with the Group. */
  nodes: {
    [nodeId: string]: {
      id: string;
      metrics: {
        [metricId: string]: UMetric;
      };
      devices: {
        [deviceId: string]: {
          id: string;
          metrics: {
            [metricId: string]: UMetric;
          };
        };
      };
    };
  };
}

/**
 * Interface for a flattened Sparkplug Device.
 * @interface SparkplugDeviceFlat
 */
export interface SparkplugDeviceFlat {
  /** The device identifier. */
  id: string;
  /** The metrics associated with the Device. */
  metrics: UMetric[];
}

/**
 * Interface for a flattened Sparkplug Node.
 * @interface SparkplugNodeFlat
 */
export interface SparkplugNodeFlat {
  /** The node identifier. */
  id: string;
  /** The metrics associated with the Node. */
  metrics: SparkplugMetric[];
  /** The flattened devices associated with the Node. */
  devices: SparkplugDeviceFlat[];
}

/**
 * Interface for a flattened Sparkplug Group.
 * @interface SparkplugGroupFlat
 */
export interface SparkplugGroupFlat {
  /** The group identifier. */
  id: string;
  /** The flattened nodes associated with the Group. */
  nodes: SparkplugNodeFlat[];
}

/**
 * Interface for a Sparkplug Node.
 * @interface SparkplugNode
 * @extends {SparkplugCreateNodeInput}
 */
export interface SparkplugNode extends SparkplugCreateNodeInput {
  /** The birth/death sequence number. */
  bdseq: number;
  /** The sequence number. */
  seq: number;
  /** The MQTT client instance. */
  mqtt: mqtt.MqttClient | null;
  /** The connection states. */
  states: {
    connected: { born: boolean; dead: boolean };
    disconnected: boolean;
  };
  /** The event emitter for the Node. */
  events: EventEmitter;
  /** The devices associated with the Node. */
  devices: {
    [id: string]: SparkplugDevice;
  };
  /** The scan rates for the Node. */
  scanRates: SparkplugNodeScanRates;
}

/**
 * Interface for creating a Sparkplug Device input.
 * @interface SparkplugCreateDeviceInput
 */
export interface SparkplugCreateDeviceInput {
  /** The device identifier. */
  id: string;
  /** The metrics associated with the Device. */
  metrics: {
    [id: string]: SparkplugMetric;
  };
}

/**
 * Interface for a Sparkplug Device.
 * @interface SparkplugDevice
 * @extends {SparkplugCreateDeviceInput}
 */
export interface SparkplugDevice extends SparkplugCreateDeviceInput {
  /** The connection states. */
  states: {
    born: boolean;
    dead: boolean;
  };
  /** The event emitter for the Device. */
  events: EventEmitter;
}

/**
 * Interface for a Sparkplug Metric.
 * @interface SparkplugMetric
 * @extends {UMetric}
 */
export interface SparkplugMetric extends Omit<UMetric, "value"> {
  /** The scan rate for the metric. */
  scanRate?: number;
  /** The deadband configuration for the metric. */
  deadband?: {
    maxTime?: number;
    value: number;
  };
  /**
   * The value of the metric. Can be one of:
   * - A direct value matching UMetric["value"] type
   * - A synchronous function that returns a UMetric["value"]
   * - An asynchronous function that returns a Promise resolving to UMetric["value"]
   */
  value:
    | UMetric["value"]
    | (() => UMetric["value"])
    | (() => Promise<UMetric["value"]>);
  /** The last published information for the metric. */
  lastPublished?: {
    timestamp: number;
    value: UMetric["value"];
  };
}

/** Type representing a parsed Sparkplug B topic */
export type SparkplugTopic = {
  version: string;
  groupId: string;
  commandType: string;
  edgeNode: string;
  deviceId?: string;
};
