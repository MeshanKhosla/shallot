# @shallot/e2e

This package contains the end-to-end gateway tests. The tests start the
Sidecar, Relay, Exit, and mock provider on ephemeral ports, then call the
Sidecar through Vercel's AI SDK.

The suite covers buffered and streaming text, tool calls, structured output,
provider errors, cancellation, authentication, replay protection, and the
privacy boundary between the Relay and Exit.

Run it from the repository root:

```sh
bun run test:e2e
```
