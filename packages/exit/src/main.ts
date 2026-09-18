import { stopOnSignals } from "@shallot/server-runtime";
import { createExitApplication } from "./application.ts";

const server = createExitApplication();
console.log(`shallot exit listening on http://${server.hostname}:${server.port}`);

stopOnSignals("exit", server);
