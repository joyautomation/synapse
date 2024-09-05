import type { IClientOptions } from "npm:mqtt";
import type mqtt from "npm:mqtt";
import type { UMetric } from "npm:sparkplug-payload/lib/sparkplugbpayload.js";
import type { EventEmitter } from "node:events";
import type { PayloadOptions } from "./compression/types.d.ts";

export type SparkplugClientType = "host" | "edge";

export type EventListener = (...args: any[]) => void;

export interface ISparkplugBaseOptions {
  serverUrl: string;
  username: string;
  password: string;
  clientId: string;
  publishDeath?: boolean;
  version?: string;
  keepalive?: number;
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

export interface ISparkplugEdgeOptions extends ISparkplugBaseOptions {
  groupId: string;
  edgeNode: string;
}

export interface ISparkplugHostOptions extends ISparkplugBaseOptions {
  primaryHostId: string;
}

export interface SparkplugCreateBaseInput {
  clientId: string;
  brokerUrl: string;
  username: string;
  password: string;
  id: string;
  version?: string;
  keepalive?: number;
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

export interface SparkplugCreateNodeInput extends SparkplugCreateBaseInput {
  groupId: string;
  metrics: {
    [id: string]: SparkplugMetric;
  };
  payloadOptions?: PayloadOptions;
  devices: {
    [id: string]: SparkplugCreateDeviceInput;
  };
}

export interface SparkplugNodeScanRates {
  [key: number]: ReturnType<typeof setInterval>;
}

export interface SparkplugBase extends SparkplugCreateBaseInput {
  bdseq: number;
  seq: number;
  mqtt: mqtt.MqttClient | null;
  states: {
    connected: boolean;
    disconnected: boolean;
  };
  events: EventEmitter;
}

export interface SparkplugCreateHostInput extends SparkplugCreateBaseInput {
  primaryHostId: string;
}
export interface SparkplugHost extends SparkplugBase {
  primaryHostId: string;
}

export interface SparkplugNode extends SparkplugCreateNodeInput {
  bdseq: number;
  seq: number;
  mqtt: mqtt.MqttClient | null;
  states: {
    connected: { born: boolean; dead: boolean };
    disconnected: boolean;
  };
  events: EventEmitter;
  devices: {
    [id: string]: SparkplugDevice;
  };
  scanRates: SparkplugNodeScanRates;
}

export interface SparkplugCreateDeviceInput {
  id: string;
  metrics: {
    [id: string]: SparkplugMetric;
  };
}

export interface SparkplugDevice extends SparkplugCreateDeviceInput {
  states: {
    born: boolean;
    dead: boolean;
  };
  events: EventEmitter;
}

export interface SparkplugMetric extends UMetric {
  scanRate?: number;
  deadband?: {
    maxTime?: number;
    value: number;
  };
  lastPublished?: {
    timestamp: number;
    value: number | string | boolean;
  };
}
