import { describe, expect, test } from "bun:test";
import {
  createDebugLogger,
  type DebugLogEntry,
  formatBodyForDebug,
  formatCiphertextPreview,
  formatDebugEntry,
} from "./index.ts";

describe("debug logger", () => {
  test("emits a structured component view when enabled", () => {
    const entries: DebugLogEntry[] = [];
    const logger = createDebugLogger("relay", {
      enabled: true,
      sink: (entry) => entries.push(entry),
    });

    logger.debug("request.received", {
      tenantId: "tenant-one",
      prompt: "abcdefghij... [encrypted]",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "debug",
      component: "relay",
      event: "request.received",
      view: { tenantId: "tenant-one", prompt: "abcdefghij... [encrypted]" },
    });
  });

  test("does not invoke the sink when disabled", () => {
    let called = false;
    const logger = createDebugLogger("exit", {
      enabled: false,
      sink: () => {
        called = true;
      },
    });

    logger.debug("request.decrypted", { tenantId: "unknown" });

    expect(called).toBeFalse();
  });

  test("formats terminal output with a readable header and indented view", () => {
    const output = formatDebugEntry({
      timestamp: "2026-09-16T19:25:45.851Z",
      level: "debug",
      component: "sidecar",
      event: "request.received",
      view: { tenantCredential: "present", request: { model: "mock-text" } },
    });

    expect(output).toBe(
      '2026-09-16T19:25:45.851Z  DEBUG  sidecar  request.received\n{\n  "tenantCredential": "present",\n  "request": {\n    "model": "mock-text"\n  }\n}',
    );
  });

  test("parses JSON bodies for nested debug output", () => {
    expect(formatBodyForDebug('{"answer":"hello"}')).toEqual({ answer: "hello" });
    expect(formatBodyForDebug("data: streamed text")).toBe("data: streamed text");
    expect(formatBodyForDebug("")).toBe("");
  });

  test("shows a bounded ciphertext preview", () => {
    expect(formatCiphertextPreview("abcdefghijklmnop")).toBe("abcdefghij... [encrypted]");
    expect(formatCiphertextPreview("short")).toBe("short [encrypted]");
    expect(() => formatCiphertextPreview("ciphertext", 0)).toThrow(
      "visible ciphertext characters must be a positive integer",
    );
  });
});
