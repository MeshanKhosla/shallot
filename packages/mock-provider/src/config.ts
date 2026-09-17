export interface ProviderObservation {
  authorization: string | null;
  request: Record<string, unknown>;
}

export interface MockProviderConfig {
  hostname: string;
  port: number;
  expectedApiKey?: string;
  chunkDelayMs: number;
}

export function loadConfig(): MockProviderConfig {
  return {
    hostname: process.env.MOCK_PROVIDER_HOSTNAME ?? "127.0.0.1",
    port: nonNegativeInteger("MOCK_PROVIDER_PORT", 8785),
    expectedApiKey: process.env.MOCK_PROVIDER_API_KEY,
    chunkDelayMs: nonNegativeInteger("MOCK_PROVIDER_CHUNK_DELAY_MS", 1),
  };
}

function nonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}
