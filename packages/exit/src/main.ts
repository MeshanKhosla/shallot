import { runServer } from "@shallot/server-runtime";
import { createExitApplication } from "./application.ts";

runServer("exit", createExitApplication);
