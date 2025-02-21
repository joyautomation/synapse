import { logs } from "./log.ts";
const { main: log } = logs;

export function setupMemoryMonitoring(intervalMs = 2000) {
  return setInterval(() => {
    const used = Deno.memoryUsage();
    log.info(`Memory Usage - Heap: ${Math.round(used.heapUsed / 1024 / 1024)}MB, RSS: ${Math.round(used.rss / 1024 / 1024)}MB`);
  }, intervalMs);
}