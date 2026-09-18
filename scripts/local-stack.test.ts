import { describe, expect, test } from "bun:test";
import {
  createConcurrentCommands,
  createLocalServiceCommand,
  createLocalServices,
} from "./local-stack.ts";

const KEYS = {
  privateKey: "private-key",
  publicKey: "public-key",
};

describe("local stack", () => {
  test("connects the four services using local defaults", () => {
    const services = createLocalServices(KEYS, {});
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.provider?.MOCK_PROVIDER_API_KEY).toBe("provider-local");
    expect(byName.exit).toMatchObject({
      EXIT_PRIVATE_KEY: "private-key",
      EXIT_RELAY_TOKEN: "relay-to-exit-local",
      LLM_PROVIDER_URL: "http://127.0.0.1:8785/v1/chat/completions",
      LLM_PROVIDER_API_KEY: "provider-local",
    });
    expect(byName.relay).toMatchObject({
      RELAY_TENANT_TOKENS: "demo:tenant-local",
      RELAY_EXIT_URL: "http://127.0.0.1:8786/v1/chat/completions",
    });
    expect(byName.sidecar).toMatchObject({
      SIDECAR_EXIT_PUBLIC_KEY: "public-key",
      SIDECAR_RELAY_URL: "http://127.0.0.1:8787/v1/chat/completions",
    });
  });

  test("derives service URLs from overridden ports", () => {
    const services = createLocalServices(KEYS, {
      MOCK_PROVIDER_PORT: "18885",
      EXIT_PORT: "18886",
      RELAY_PORT: "18887",
      SIDECAR_PORT: "18888",
    });
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.exit?.LLM_PROVIDER_URL).toBe(
      "http://127.0.0.1:18885/v1/chat/completions",
    );
    expect(byName.relay?.RELAY_EXIT_URL).toBe(
      "http://127.0.0.1:18886/v1/chat/completions",
    );
    expect(byName.sidecar?.SIDECAR_RELAY_URL).toBe(
      "http://127.0.0.1:18887/v1/chat/completions",
    );
  });

  test("uses a configured LLM provider instead of the local mock", () => {
    const services = createLocalServices(KEYS, {
      LLM_PROVIDER_URL: "https://llm.example/v1/chat/completions",
      LLM_PROVIDER_API_KEY: "llm-secret",
    });
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.exit?.LLM_PROVIDER_URL).toBe("https://llm.example/v1/chat/completions");
    expect(byName.exit?.LLM_PROVIDER_API_KEY).toBe("llm-secret");
    expect(byName.provider?.MOCK_PROVIDER_API_KEY).toBe("provider-local");
  });

  test("assigns a stable inspector endpoint to each service", () => {
    const services = createLocalServices(KEYS, {});

    expect(services.map((service) => createLocalServiceCommand(service, true))).toEqual([
      "bun --inspect=127.0.0.1:6499/provider packages/mock-provider/src/main.ts",
      "bun --inspect=127.0.0.1:6500/exit packages/exit/src/main.ts",
      "bun --inspect=127.0.0.1:6501/relay packages/relay/src/main.ts",
      "bun --inspect=127.0.0.1:6502/sidecar packages/client/src/main.ts",
    ]);
  });

  test("uses longer upstream timeouts while debugging", () => {
    const services = createLocalServices(KEYS, {}, { inspect: true });
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.sidecar?.SIDECAR_RELAY_TIMEOUT_MS).toBe("600000");
    expect(byName.relay?.RELAY_EXIT_TIMEOUT_MS).toBe("600000");
    expect(byName.exit?.LLM_PROVIDER_TIMEOUT_MS).toBe("600000");
  });

  test("preserves explicit timeout overrides while debugging", () => {
    const services = createLocalServices(
      KEYS,
      {
        SIDECAR_RELAY_TIMEOUT_MS: "700000",
        RELAY_EXIT_TIMEOUT_MS: "800000",
        LLM_PROVIDER_TIMEOUT_MS: "900000",
      },
      { inspect: true },
    );
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.sidecar?.SIDECAR_RELAY_TIMEOUT_MS).toBe("700000");
    expect(byName.relay?.RELAY_EXIT_TIMEOUT_MS).toBe("800000");
    expect(byName.exit?.LLM_PROVIDER_TIMEOUT_MS).toBe("900000");
  });

  test("gives each process a named color prefix", () => {
    const services = createLocalServices(KEYS, {});

    expect(createConcurrentCommands(services)).toEqual([
      expect.objectContaining({ name: "provider", prefixColor: "blue" }),
      expect.objectContaining({ name: "exit", prefixColor: "magenta" }),
      expect.objectContaining({ name: "relay", prefixColor: "yellow" }),
      expect.objectContaining({ name: "sidecar", prefixColor: "cyan" }),
    ]);
  });
});
