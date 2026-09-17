import { describe, expect, test } from "bun:test";
import { createLocalServices } from "./local-stack.ts";

const KEYS = {
  privateKey: "private-key",
  publicKey: "public-key",
};

describe("local stack", () => {
  test("connects the four services using local defaults", () => {
    const services = createLocalServices("/repo", KEYS, {});
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.provider?.MOCK_PROVIDER_API_KEY).toBe("provider-local");
    expect(byName.exit).toMatchObject({
      EXIT_PRIVATE_KEY: "private-key",
      EXIT_RELAY_TOKEN: "relay-to-exit-local",
      EXIT_PROVIDER_URL: "http://127.0.0.1:8785/v1/chat/completions",
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
    const services = createLocalServices("/repo", KEYS, {
      MOCK_PROVIDER_PORT: "18885",
      EXIT_PORT: "18886",
      RELAY_PORT: "18887",
      SIDECAR_PORT: "18888",
    });
    const byName = Object.fromEntries(
      services.map((service) => [service.name, service.environment]),
    );

    expect(byName.exit?.EXIT_PROVIDER_URL).toBe(
      "http://127.0.0.1:18885/v1/chat/completions",
    );
    expect(byName.relay?.RELAY_EXIT_URL).toBe(
      "http://127.0.0.1:18886/v1/chat/completions",
    );
    expect(byName.sidecar?.SIDECAR_RELAY_URL).toBe(
      "http://127.0.0.1:18887/v1/chat/completions",
    );
  });
});
