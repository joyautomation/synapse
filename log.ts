import { createLogger, Log, LogLevel } from "@joyautomation/coral";
import { setLogLevel as setCoralLogLevel } from "@joyautomation/coral";

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
export const logRbeEnabled = false;
export const logRbe = createLogger("neuron-rbe", getLogLevel());

/**
 * Sets the log level for the logger.
 * @param {LogLevel} level - The log level to set.
 */
export const setLogLevel = (level: LogLevel): Log[] => {
  return [setCoralLogLevel(log, level), setCoralLogLevel(logRbe, level)];
};
