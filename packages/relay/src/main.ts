import { runServer } from "@shallot/server-runtime";
import { createRelayApplication } from "./application.ts";

runServer("relay", createRelayApplication);
