import { stopOnSignals } from "@shallot/server-runtime";
import { Effect } from "effect";
import { createRelayApplication } from "./application.ts";

const server = await Effect.runPromise(createRelayApplication);
console.log(`shallot relay listening on http://${server.hostname}:${server.port}`);

stopOnSignals("relay", server);
