import { describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { bindRuntimeLifecycle, type DisposableRuntime } from "../src/lifecycle.ts";

function serverWithStop(stop: Server<undefined>["stop"]): Server<undefined> {
  return { stop } as Server<undefined>;
}

describe("Effect server lifecycle", () => {
  test("stops Bun before disposing the runtime and is idempotent", async () => {
    const events: string[] = [];
    const server = bindRuntimeLifecycle(
      serverWithStop(async () => {
        events.push("server.stop");
      }),
      {
        async dispose() {
          events.push("runtime.dispose");
        },
      },
    );

    const first = server.stop(true);
    const second = server.stop(false);

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(events).toEqual(["server.stop", "runtime.dispose"]);
  });

  test("disposes the runtime when Bun shutdown fails", async () => {
    const events: string[] = [];
    const runtime: DisposableRuntime = {
      async dispose() {
        events.push("runtime.dispose");
      },
    };
    const server = bindRuntimeLifecycle(
      serverWithStop(async () => {
        events.push("server.stop");
        throw new Error("stop failed");
      }),
      runtime,
    );

    await expect(server.stop(true)).rejects.toThrow("stop failed");
    expect(events).toEqual(["server.stop", "runtime.dispose"]);
  });
});
