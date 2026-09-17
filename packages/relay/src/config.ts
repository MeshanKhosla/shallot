export interface RelayConfig {
  hostname: string;
  port: number;
  exitUrl: URL;
  exitToken: string;
  tenantTokens: ReadonlyMap<string, string>;
  requestTtlMs: number;
  maxRequestEntries: number;
  maxRequestEntriesPerTenant: number;
  maxEnvelopeBytes: number;
  maxConcurrentRequests: number;
  exitTimeoutMs: number;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function tenantTokensFromEnvironment(): Map<string, string> {
  const configured = process.env.RELAY_TENANT_TOKENS;
  if (!configured) {
    throw new Error("RELAY_TENANT_TOKENS is required");
  }

  const tokens = new Map<string, string>();
  for (const entry of configured.split(",")) {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error("RELAY_TENANT_TOKENS must use tenant:token entries");
    }
    tokens.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  return tokens;
}

export function loadConfig(): RelayConfig {
  const exitToken = process.env.RELAY_EXIT_TOKEN;
  if (!exitToken) throw new Error("RELAY_EXIT_TOKEN is required");

  return {
    hostname: process.env.RELAY_HOSTNAME ?? "127.0.0.1",
    port: positiveInteger("RELAY_PORT", 8787),
    exitUrl: new URL(
      process.env.RELAY_EXIT_URL ?? "http://127.0.0.1:8786/v1/chat/completions",
    ),
    exitToken,
    tenantTokens: tenantTokensFromEnvironment(),
    requestTtlMs: positiveInteger("RELAY_REQUEST_TTL_MS", 5 * 60_000),
    maxRequestEntries: positiveInteger("RELAY_REQUEST_MAX_ENTRIES", 100_000),
    maxRequestEntriesPerTenant: positiveInteger(
      "RELAY_REQUEST_MAX_ENTRIES_PER_TENANT",
      10_000,
    ),
    maxEnvelopeBytes: positiveInteger("RELAY_MAX_ENVELOPE_BYTES", 3 * 1024 * 1024),
    maxConcurrentRequests: positiveInteger("RELAY_MAX_CONCURRENT_REQUESTS", 100),
    exitTimeoutMs: positiveInteger("RELAY_EXIT_TIMEOUT_MS", 65_000),
  };
}
