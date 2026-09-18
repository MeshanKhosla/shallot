# @shallot/client

This package implements the local Sidecar. Applications send OpenAI-compatible
requests to the Sidecar, usually through Vercel's AI SDK.

The Sidecar reads the tenant credential without interpreting it, seals the
request body to the Exit's public key, and forwards both to the Relay. It opens
the encrypted response frames from the Exit and returns a normal HTTP response
to the application.

The package exports the Effect Platform server program, application,
configuration, and Relay client services. It does not contain the Relay or Exit
server.

Run the Sidecar as part of the local stack from the repository root:

```sh
bun run dev:local
```
