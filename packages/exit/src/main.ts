import { stopOnSignals } from "@shallot/server-runtime";
import { Effect } from "effect";
import { createExitApplication } from "./application.ts";

const server = await Effect.runPromise(createExitApplication);
console.log(`shallot exit listening on http://${server.hostname}:${server.port}`);

stopOnSignals("exit", server);
