import { LogLevel, createLogger } from "jsr:@joyautomation/coral@0.0.7";

/**
 * Determines the log level based on the environment variable.
 * @returns {LogLevel} The determined log level.
 */
export function getLogLevel(): LogLevel {
  const envLogLevel = Deno.env.get("NEURON_LOG_LEVEL");
  if (envLogLevel && envLogLevel in LogLevel) {
    return LogLevel[envLogLevel as keyof typeof LogLevel];
  }
  return LogLevel.info;
}

/**
 * Creates and exports a logger instance for the "neuron" module.
 * The log level is determined by the getLogLevel function.
 */
export const log = createLogger("neuron", getLogLevel());
