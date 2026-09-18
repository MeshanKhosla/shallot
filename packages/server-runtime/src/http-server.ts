import { BunHttpServer } from "@effect/platform-bun";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export interface HttpServerConfig {
  readonly hostname: string;
  readonly port: number;
  readonly idleTimeout?: number;
}

export interface RunningHttpServer {
  readonly hostname: string;
  readonly port: number;
}

export function serveWebHandler<E, R>(
  config: HttpServerConfig,
  handle: (request: Request) => Effect.Effect<Response, E, R>,
) {
  return Effect.gen(function* () {
    const server = yield* BunHttpServer.make({
      hostname: config.hostname,
      port: config.port,
      ...(config.idleTimeout === undefined
        ? undefined
        : { idleTimeout: config.idleTimeout }),
    });

    const application = Effect.gen(function* () {
      const incoming = yield* HttpServerRequest.HttpServerRequest;
      const request = yield* HttpServerRequest.toWeb(incoming);
      const response = yield* handle(request);
      return HttpServerResponse.fromWeb(response);
    });

    yield* server.serve(application);

    if (server.address._tag === "UnixPathAddress") {
      return yield* Effect.die("Shallot HTTP servers require a TCP address");
    }

    return {
      hostname: config.hostname,
      port: server.address.port,
    } satisfies RunningHttpServer;
  });
}
