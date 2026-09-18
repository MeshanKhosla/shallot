# Debug Shallot

## Debug the local stack in VS Code

Install the recommended extensions:

```sh
code --install-extension effectful-tech.effect-vscode
code --install-extension TypeScriptTeam.native-preview
code --install-extension oven.bun-vscode
```

Run `bun install`, reload VS Code, then choose `TypeScript: Enable TypeScript 7`
from the command palette.

The Bun extension handles breakpoints, stepping, call stacks, and variables.
Effect DevTools shows fibers, services in Context, span stacks, and defects. It
does not control execution.

Open Effect DevTools and select `Start the server`. Start the local stack with
the Bun inspector and the Effect DevTools client enabled:

```sh
bun run dev:debug
```

Open Run and Debug, choose `Attach: Local Shallot stack`, and press F5. VS Code
attaches to the mock provider, Exit, Relay, and Sidecar.

Set breakpoints before sending a request:

```sh
curl http://127.0.0.1:8788/v1/chat/completions \
  -H "Authorization: Bearer tenant-local" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mock-text",
    "messages": [
      {
        "role": "user",
        "content": "Hello from the Sidecar"
      }
    ]
  }'
```

Use Continue to move between breakpoints in separate services. Step Over cannot
cross an HTTP request because each service is a separate Bun process.

`bun run dev:debug` gives the Sidecar, Relay, and provider calls ten-minute
timeouts. Set `SIDECAR_RELAY_TIMEOUT_MS`, `RELAY_EXIT_TIMEOUT_MS`, or
`LLM_PROVIDER_TIMEOUT_MS` to override those values.

## Read debug logs

`bun run dev:local` enables `SHALLOT_LOG_LEVEL=debug`. It prints one structured
event per line with a color-coded service prefix.

| Process | Debug log contents |
| --- | --- |
| Sidecar | Tenant credential and plaintext request and response |
| Relay | Tenant identity, request ID, and encrypted request and response data |
| Exit | Plaintext request and provider response. Tenant is `unknown`. |
| Mock provider | Plaintext provider request and response. Tenant is `unknown`. |

The logs contain prompt and response text on machines allowed to read it. Do not
send those logs to a shared service in a deployment.

## Debug services on separate hosts

Use [separate-machines.md](separate-machines.md) to start Sidecar, Relay, Exit,
and the provider on different hosts. Set `SHALLOT_LOG_LEVEL=debug` on each
process to inspect its local view.
