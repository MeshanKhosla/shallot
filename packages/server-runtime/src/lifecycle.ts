import type { Server } from "bun";
import type { ManagedRuntime } from "effect";

export interface EffectServer extends Server<undefined> {
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export function bindRuntimeLifecycle<R>(
  server: Server<undefined>,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
): EffectServer {
  const stopServer = server.stop.bind(server);
  let shutdown: Promise<void> | undefined;

  server.stop = (closeActiveConnections?: boolean) => {
    shutdown ??= (async () => {
      let stopFailure: unknown;
      try {
        await stopServer(closeActiveConnections);
      } catch (error) {
        stopFailure = error;
      }

      try {
        await runtime.dispose();
      } catch (disposeFailure) {
        if (stopFailure !== undefined) {
          throw new AggregateError(
            [stopFailure, disposeFailure],
            "Server stop and Effect runtime disposal failed",
          );
        }
        throw disposeFailure;
      }

      if (stopFailure !== undefined) throw stopFailure;
    })();
    return shutdown;
  };

  return server;
}

export function stopOnSignals(component: string, server: EffectServer): void {
  const shutdown = async () => {
    try {
      await server.stop(true);
    } catch {
      console.error(JSON.stringify({ component, event: "shutdown.failed" }));
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
