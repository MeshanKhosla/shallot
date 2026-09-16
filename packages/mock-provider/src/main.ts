import { createMockProviderServer } from "./mock-provider.ts";

const server = createMockProviderServer();
console.log(
  `shallot mock provider listening on http://${server.hostname}:${server.port}`,
);
