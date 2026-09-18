import { expect, test } from "bun:test";
import { Effect } from "effect";
import { serveWebHandler } from "../src/http-server.ts";
import { launchHttpServer } from "../src/lifecycle.ts";

test("a launched HTTP server closes its Effect scope once", async () => {
  let finalized = 0;
  const application = Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => finalized++));
    return yield* serveWebHandler({ hostname: "127.0.0.1", port: 0 }, () =>
      Effect.succeed(new Response("ok")),
    );
  });

  const server = await launchHttpServer(application);
  const body = await fetch(`http://${server.hostname}:${server.port}`).then((response) =>
    response.text(),
  );
  expect(body).toBe("ok");

  const first = server.stop();
  const second = server.stop();
  expect(second).toBe(first);
  await first;
  expect(finalized).toBe(1);
});
