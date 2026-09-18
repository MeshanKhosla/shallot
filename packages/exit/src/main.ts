import { runServer } from "@shallot/server-runtime";
import { createExitApplication } from "./application.ts";

await runServer("exit", createExitApplication);
