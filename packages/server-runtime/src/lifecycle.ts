import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Exit, Scope } from "effect";
import type { RunningHttpServer } from "./http-server.ts";

export function runServer<E>(
  component: string,
  application: Effect.Effect<RunningHttpServer, E, Scope.Scope>,
): void {
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* application;
      yield* Console.log(
        `shallot ${component} listening on http://${server.hostname}:${server.port}`,
      );
      return yield* Effect.never;
    }),
  ).pipe(BunRuntime.runMain);
}

export interface LaunchedHttpServer extends RunningHttpServer {
  stop(): Promise<void>;
}

export async function launchHttpServer<E>(
  application: Effect.Effect<RunningHttpServer, E, Scope.Scope>,
): Promise<LaunchedHttpServer> {
  const scope = await Effect.runPromise(Scope.make());
  try {
    const server = await Effect.runPromise(
      application.pipe(Effect.provideService(Scope.Scope, scope)),
    );
    let close: Promise<void> | undefined;
    return {
      ...server,
      stop() {
        close ??= Effect.runPromise(Scope.close(scope, Exit.void));
        return close;
      },
    };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
}
