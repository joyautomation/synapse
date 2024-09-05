import { LogLevel, createLogger } from "jsr:@joyautomation/coral";

export const log = createLogger(
  "neuron",
  Deno.env.get("NEURON_LOG_LEVEL") || LogLevel.info
);
