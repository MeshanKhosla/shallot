import { runServer } from "@shallot/server-runtime";
import { createMockProviderApplication } from "./application.ts";

await runServer("mock provider", createMockProviderApplication);
