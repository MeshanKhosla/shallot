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

export function formatDebugEntry(entry: DebugLogEntry): string {
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

export function formatCiphertextPreview(
  ciphertext: string,
  visibleCharacters = 10,
): string {
  if (!Number.isSafeInteger(visibleCharacters) || visibleCharacters <= 0) {
    throw new Error("visible ciphertext characters must be a positive integer");
  }
  const prefix = ciphertext.slice(0, visibleCharacters);
  const ellipsis = ciphertext.length > visibleCharacters ? "..." : "";
  return `${prefix}${ellipsis} [encrypted]`;
}

export function createDebugLogger(
  component: string,
  options: DebugLoggerOptions = {},
): DebugLogger {
  const enabled = options.enabled ?? process.env.SHALLOT_LOG_LEVEL === "debug";
  const sink =
    options.sink ?? ((entry: DebugLogEntry) => console.log(formatDebugEntry(entry)));

  return {
    enabled,
    debug(event, view) {
      if (!enabled) return;
      try {
        sink({
          timestamp: new Date().toISOString(),
          level: "debug",
          component,
          event,
          view,
        });
      } catch {
        // Debug output must not alter request processing.
      }
    },
  };
}
