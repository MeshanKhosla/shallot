import type { Server } from "bun";
import { Effect } from "effect";

export interface EffectServer extends Server<undefined> {
  stop(closeActiveConnections?: boolean): Promise<void>;
}

export interface DisposableRuntime {
  dispose(): Promise<void>;
}

export function bindRuntimeLifecycle(
  server: Server<undefined>,
  runtime: DisposableRuntime,
): EffectServer {
  const stopServer = server.stop.bind(server);
  let shutdown: Promise<void> | undefined;

  server.stop = (closeActiveConnections?: boolean) => {
    // Reuse the first shutdown so Bun and the runtime are each stopped once.
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

export function runServer<E>(
  component: string,
  application: Effect.Effect<EffectServer, E>,
): Promise<void> {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* Effect.acquireRelease(application, (server: EffectServer) =>
          Effect.promise(() => server.stop(true)),
        );
        yield* Effect.sync(() =>
          console.log(
            `shallot ${component} listening on http://${server.hostname}:${server.port}`,
          ),
        );
        yield* waitForShutdownSignal;
      }),
    ),
  );
}

const waitForShutdownSignal = Effect.callback<void>((resume) => {
  const shutdown = () => resume(Effect.void);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return Effect.sync(() => {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  });
});
