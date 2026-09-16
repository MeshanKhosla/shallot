import { describe, expect, test } from "bun:test";
import { createDebugLogger, type DebugLogEntry } from "./index.ts";

describe("debug logger", () => {
  test("emits a structured component view when enabled", () => {
    const entries: DebugLogEntry[] = [];
    const logger = createDebugLogger("relay", {
      enabled: true,
      sink: (entry) => entries.push(entry),
    });

    logger.debug("request.received", { tenantId: "tenant-one", prompt: "[encrypted]" });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: "debug",
      component: "relay",
      event: "request.received",
      view: { tenantId: "tenant-one", prompt: "[encrypted]" },
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
});
