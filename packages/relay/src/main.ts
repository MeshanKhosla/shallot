import { runServer } from "@shallot/server-runtime";
import { createRelayApplication } from "./application.ts";

await runServer("relay", createRelayApplication);
