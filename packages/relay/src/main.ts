import { createRelayServer } from "./relay.ts";

const server = createRelayServer();
console.log(`shallot relay listening on http://${server.hostname}:${server.port}`);

const shutdown = () => {
  void server.stop(true);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
