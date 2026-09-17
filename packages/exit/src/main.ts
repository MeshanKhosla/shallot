import { loadConfig } from "./config.ts";
import { createExitServer } from "./exit.ts";

const server = createExitServer(loadConfig());
console.log(`shallot exit listening on http://${server.hostname}:${server.port}`);

const shutdown = () => {
  void server.stop(true);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
