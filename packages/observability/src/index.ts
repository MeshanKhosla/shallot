export interface DebugLogEntry {
  timestamp: string;
  level: "debug";
  component: string;
  event: string;
  view: Record<string, unknown>;
}

export interface DebugLogger {
  readonly enabled: boolean;
  debug(event: string, view: Record<string, unknown>): void;
}

interface DebugLoggerOptions {
  enabled?: boolean;
  sink?: (entry: DebugLogEntry) => void;
}

function writeJson(entry: DebugLogEntry): void {
  console.log(JSON.stringify(entry));
}

export function createDebugLogger(
  component: string,
  options: DebugLoggerOptions = {},
): DebugLogger {
  const enabled = options.enabled ?? process.env.SHALLOT_LOG_LEVEL === "debug";
  const sink = options.sink ?? writeJson;

  return {
    enabled,
    debug(event, view) {
      if (!enabled) return;
      sink({
        timestamp: new Date().toISOString(),
        level: "debug",
        component,
        event,
        view,
      });
    },
  };
}
