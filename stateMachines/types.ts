import type { Buffer } from "node:buffer";
import EventEmitter from "node:events";
import type { UPayload } from "sparkplug-payload/lib/sparkplugbpayload.js";

export type HostTransition = "connect" | "disconnect";

export type HostEvent = "connect" | "disconnect" | "message";

export type Listener =
  | ((topic: string, message: Buffer) => void)
  | ((topic: string, message: UPayload) => void);

export type NodeEvent =
  | "connect"
  | "disconnect"
  | "message"
  | "ncmd"
  | "dcmd"
  | "ddata"
  | "dbirth"
  | "ddeath"
  | "ndata"
  | "nbirth"
  | "ndeath";

export type NodeTransition = "connect" | "disconnect" | "birth" | "death";

export type TypedEventEmitter<Events extends Record<string, unknown>> = {
  on<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): void;
  off<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
} & EventEmitter;
