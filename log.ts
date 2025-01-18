import {
  createLogger,
  type Log,
  LogLevel,
  setEnabled as setCoralLogEnable,
  setLogLevel as setCoralLogLevel,
} from "@joyautomation/coral";

export function getLogLevel(): LogLevel {
  const envLogLevel = Deno.env.get("SYNAPSE_LOG_LEVEL");
  if (envLogLevel && envLogLevel in LogLevel) {
    return LogLevel[envLogLevel as keyof typeof LogLevel];
  }
  return LogLevel.info;
}

const createSynapseLog = (name: string): Log =>
  createLogger(`synapse${name ? "-" : ""}${name}`, getLogLevel());

const rbe: Log = createSynapseLog("rbe");
setCoralLogEnable(rbe, false);

export const logs: Record<string, Log> = {
  main: createSynapseLog(""),
  rbe,
};

export const disableLog = (name: keyof typeof logs): Log => {
  return setCoralLogEnable(logs[name], false);
};

export const enableLog = (name: keyof typeof logs): Log => {
  return setCoralLogEnable(logs[name], true);
};

export const setLogLevel = (level: LogLevel): Log[] => {
  return Object.values(logs).map((log) => setCoralLogLevel(log, level));
};
