import { createRelayServer } from "./relay.ts";

const server = createRelayServer();
console.log(`shallot relay listening on http://127.0.0.1:${server.port}`);
