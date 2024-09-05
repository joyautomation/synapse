import { type UPayload } from "npm:sparkplug-payload/lib/sparkplugbpayload.js";

export type CompressPayloadInput = {
  payload: UPayload;
  options?: PayloadOptions;
};

export type PayloadOptions = {
  algorithm?: "GZIP" | "DEFLATE";
  /** @default false */
  compress?: boolean;
};
