import type { Buffer } from "node:buffer";
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
