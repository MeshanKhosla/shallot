import { loadConfig } from "./config.ts";
import { createExitServer } from "./exit.ts";

const server = createExitServer(loadConfig());
console.log(`shallot exit listening on http://${server.hostname}:${server.port}`);
