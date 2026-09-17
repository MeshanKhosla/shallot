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

export type DebugLogFormat = "json" | "pretty";

interface DebugLoggerOptions {
  enabled?: boolean;
  format?: DebugLogFormat;
  sink?: (entry: DebugLogEntry) => void;
}

function logFormatFromEnvironment(): DebugLogFormat {
  const format = process.env.SHALLOT_LOG_FORMAT ?? "json";
  if (format !== "json" && format !== "pretty") {
    throw new Error("SHALLOT_LOG_FORMAT must be json or pretty");
  }
  return format;
}

export function formatDebugEntry(entry: DebugLogEntry, format: DebugLogFormat): string {
  if (format === "json") return JSON.stringify(entry);
  const header = `${entry.timestamp}  DEBUG  ${entry.component}  ${entry.event}`;
  return `${header}\n${JSON.stringify(entry.view, null, 2)}`;
}

export function formatBodyForDebug(body: string): unknown {
  if (body.length === 0) return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

export function createDebugLogger(
  component: string,
  options: DebugLoggerOptions = {},
): DebugLogger {
  const enabled = options.enabled ?? process.env.SHALLOT_LOG_LEVEL === "debug";
  const format = options.format ?? logFormatFromEnvironment();
  const sink =
    options.sink ??
    ((entry: DebugLogEntry) => console.log(formatDebugEntry(entry, format)));

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
