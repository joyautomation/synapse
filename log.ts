import { LogLevel, createLogger } from "jsr:@joyautomation/coral";

function getLogLevel(): LogLevel {
  const envLogLevel = Deno.env.get("NEURON_LOG_LEVEL");
  if (envLogLevel && envLogLevel in LogLevel) {
    return LogLevel[envLogLevel as keyof typeof LogLevel];
  }
  return LogLevel.info;
}

export const log = createLogger("neuron", getLogLevel());
