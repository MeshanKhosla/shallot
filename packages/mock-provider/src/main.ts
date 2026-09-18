import { runServer } from "@shallot/server-runtime";
import { createMockProviderApplication } from "./application.ts";

runServer("mock provider", createMockProviderApplication);
