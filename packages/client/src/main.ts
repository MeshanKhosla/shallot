import { stopOnSignals } from "@shallot/server-runtime";
import { createSidecarServer } from "./sidecar.ts";

const server = createSidecarServer();
console.log(`shallot sidecar listening on http://${server.hostname}:${server.port}`);

stopOnSignals("sidecar", server);
