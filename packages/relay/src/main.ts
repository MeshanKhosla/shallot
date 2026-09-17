import { stopOnSignals } from "@shallot/server-runtime";
import { createRelayServer } from "./relay.ts";

const server = createRelayServer();
console.log(`shallot relay listening on http://${server.hostname}:${server.port}`);

stopOnSignals("relay", server);
