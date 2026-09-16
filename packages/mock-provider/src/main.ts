import { createMockProviderServer } from "./mock-provider.ts";

const server = createMockProviderServer();
console.log(`shallot mock provider listening on http://127.0.0.1:${server.port}`);
