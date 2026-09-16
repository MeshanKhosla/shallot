import { createSidecarServer } from "./sidecar.ts";

const server = createSidecarServer();
console.log(`shallot sidecar listening on http://127.0.0.1:${server.port}`);
