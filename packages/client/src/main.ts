import { stopOnSignals } from "@shallot/server-runtime";
import { Effect } from "effect";
import { createSidecarApplication } from "./application.ts";

const server = await Effect.runPromise(createSidecarApplication);
console.log(`shallot sidecar listening on http://${server.hostname}:${server.port}`);

stopOnSignals("sidecar", server);
