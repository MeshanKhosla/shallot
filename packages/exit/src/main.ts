import { createExitServer } from "./exit.ts";

const server = createExitServer();
console.log(`shallot exit listening on http://${server.hostname}:${server.port}`);
