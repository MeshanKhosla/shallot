import { runServer } from "@shallot/server-runtime";
import { createSidecarApplication } from "./application.ts";

runServer("sidecar", createSidecarApplication);
