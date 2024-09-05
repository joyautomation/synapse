import type { IClientOptions } from "npm:mqtt@5.10.1";
import mqtt from "npm:mqtt@5.10.1";
import { UMetric } from "npm:sparkplug-payload@1.0.3/lib/sparkplugbpayload.js";
import type { EventEmitter } from "node:events";
import type { PayloadOptions } from "./compression/types.d.ts";

/** Type of Sparkplug client */
export type SparkplugClientType = "host" | "edge";

/** Event listener function type */
export type EventListener = (...args: any[]) => void;

/** Base options for Sparkplug client */
export interface ISparkplugBaseOptions {
  /** MQTT server URL */
  serverUrl: string;
  /** MQTT username */
  username: string;
  /** MQTT password */
  password: string;
  /** MQTT client ID */
  clientId: string;
  /** Whether to publish death message */
  publishDeath?: boolean;
  /** Sparkplug version */
  version?: string;
  /** MQTT keepalive interval in seconds */
  keepalive?: number;
  /** Additional MQTT options */
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

/** Options for Sparkplug Edge Node */
export interface ISparkplugEdgeOptions extends ISparkplugBaseOptions {
  /** Sparkplug group ID */
  groupId: string;
  /** Sparkplug edge node ID */
  edgeNode: string;
}

/** Options for Sparkplug Host Application */
export interface ISparkplugHostOptions extends ISparkplugBaseOptions {
  /** Primary host ID */
  primaryHostId: string;
}

/** Base input for creating Sparkplug client */
export interface SparkplugCreateBaseInput {
  /** MQTT client ID */
  clientId: string;
  /** MQTT broker URL */
  brokerUrl: string;
  /** MQTT username */
  username: string;
  /** MQTT password */
  password: string;
  /** Unique identifier */
  id: string;
  /** Sparkplug version */
  version?: string;
  /** MQTT keepalive interval in seconds */
  keepalive?: number;
  /** Additional MQTT options */
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

/** Input for creating Sparkplug Node */
export interface SparkplugCreateNodeInput extends SparkplugCreateBaseInput {
  /** Sparkplug group ID */
  groupId: string;
  /** Metrics for the node */
  metrics: {
    [id: string]: SparkplugMetric;
  };
  /** Payload options */
  payloadOptions?: PayloadOptions;
  /** Devices connected to the node */
  devices: {
    [id: string]: SparkplugCreateDeviceInput;
  };
}

/** Scan rates for Sparkplug Node */
export interface SparkplugNodeScanRates {
  [key: number]: ReturnType<typeof setInterval>;
}

/** Base Sparkplug client interface */
export interface SparkplugBase extends SparkplugCreateBaseInput {
  /** Birth/death sequence number */
  bdseq: number;
  /** Message sequence number */
  seq: number;
  /** MQTT client instance */
  mqtt: mqtt.MqttClient | null;
  /** Client states */
  states: {
    connected: boolean;
    disconnected: boolean;
  };
  /** Event emitter */
  events: EventEmitter;
}

/** Input for creating Sparkplug Host Application */
export interface SparkplugCreateHostInput extends SparkplugCreateBaseInput {
  /** Primary host ID */
  primaryHostId: string;
}

/** Sparkplug Host Application interface */
export interface SparkplugHost extends SparkplugBase {
  /** Primary host ID */
  primaryHostId: string;
}

/** Sparkplug Node interface */
export interface SparkplugNode extends SparkplugCreateNodeInput {
  /** Birth/death sequence number */
  bdseq: number;
  /** Message sequence number */
  seq: number;
  /** MQTT client instance */
  mqtt: mqtt.MqttClient | null;
  /** Node states */
  states: {
    connected: { born: boolean; dead: boolean };
    disconnected: boolean;
  };
  /** Event emitter */
  events: EventEmitter;
  /** Devices connected to the node */
  devices: {
    [id: string]: SparkplugDevice;
  };
  /** Scan rates for the node */
  scanRates: SparkplugNodeScanRates;
}

/** Input for creating Sparkplug Device */
export interface SparkplugCreateDeviceInput {
  /** Device ID */
  id: string;
  /** Metrics for the device */
  metrics: {
    [id: string]: SparkplugMetric;
  };
}

/** Sparkplug Device interface */
export interface SparkplugDevice extends SparkplugCreateDeviceInput {
  /** Device states */
  states: {
    born: boolean;
    dead: boolean;
  };
  /** Event emitter */
  events: EventEmitter;
}

/** Sparkplug Metric interface */
export interface SparkplugMetric extends UMetric {
  /** Scan rate for the metric */
  scanRate?: number;
  /** Deadband configuration */
  deadband?: {
    /** Maximum time between updates */
    maxTime?: number;
    /** Deadband value */
    value: number;
  };
  /** Last published information */
  lastPublished?: {
    /** Timestamp of last publish */
    timestamp: number;
    /** Last published value */
    value: number | string | boolean;
  };
}
