import { stopOnSignals } from "@shallot/server-runtime";
import { Effect } from "effect";
import { createMockProviderApplication } from "./application.ts";

const server = await Effect.runPromise(createMockProviderApplication);
console.log(
  `shallot mock provider listening on http://${server.hostname}:${server.port}`,
);

stopOnSignals("mock-provider", server);
