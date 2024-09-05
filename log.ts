import { LogLevel, createLogger } from "jsr:@joyautomation/coral@0.0.7";

function getLogLevel(): LogLevel {
  const envLogLevel = Deno.env.get("NEURON_LOG_LEVEL");
  if (envLogLevel && envLogLevel in LogLevel) {
    return LogLevel[envLogLevel as keyof typeof LogLevel];
  }
  return LogLevel.info;
}

export const log = createLogger("neuron", getLogLevel());
