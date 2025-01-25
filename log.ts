import {
  createLogger,
  type Log as CoralLog,
  LogLevel,
  setEnabled as setCoralLogEnable,
  setLogLevel as setCoralLogLevel,
} from "@joyautomation/coral";

/** @internal **/
type Log = CoralLog;

/**
 * Gets the current log level from environment variable or defaults to info
 * @returns {LogLevel} The current log level. If SYNAPSE_LOG_LEVEL env var exists and is valid, returns that level; otherwise returns LogLevel.info
 */
export function getLogLevel(): LogLevel {
  const envLogLevel = Deno.env.get("SYNAPSE_LOG_LEVEL");
  if (envLogLevel && envLogLevel in LogLevel) {
    return LogLevel[envLogLevel as keyof typeof LogLevel];
  }
  return LogLevel.info;
}

/**
 * Creates a Synapse logger with a specific name
 * @param {string} name - The name suffix for the logger. Will be appended to "synapse-"
 * @returns {Log} A configured logger instance
 * @private
 */
const createSynapseLog = (name: string): Log =>
  createLogger(`synapse${name ? "-" : ""}${name}`, getLogLevel());

// Initialize RBE logger and disable it by default
const rbe: Log = createSynapseLog("rbe");
setCoralLogEnable(rbe, false);

/**
 * Collection of all available loggers in the application
 * @type {Record<string, Log>}
 */
export const logs: Record<string, Log> = {
  main: createSynapseLog(""),
  rbe,
};

/**
 * Disables a specific logger
 * @param {keyof typeof logs} name - The name of the logger to disable
 * @returns {Log} The disabled logger instance
 */
export const disableLog = (name: keyof typeof logs): Log => {
  return setCoralLogEnable(logs[name], false);
};

/**
 * Enables a specific logger
 * @param {keyof typeof logs} name - The name of the logger to enable
 * @returns {Log} The enabled logger instance
 */
export const enableLog = (name: keyof typeof logs): Log => {
  return setCoralLogEnable(logs[name], true);
};

/**
 * Sets the log level for all loggers
 * @param {LogLevel} level - The log level to set
 * @returns {Log[]} Array of logger instances that were updated
 */
export const setLogLevel = (level: LogLevel): Log[] => {
  return Object.values(logs).map((log) => setCoralLogLevel(log, level));
};
