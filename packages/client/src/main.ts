import { runServer } from "@shallot/server-runtime";
import { createSidecarApplication } from "./application.ts";

await runServer("sidecar", createSidecarApplication);
