# Shallot

_Onion routing for your AI gateway_

![Animated Shallot request flow](docs/flow.gif)

Shallot is an oblivious AI gateway for OpenAI-compatible clients. The Sidecar
encrypts a request to the Exit. The Relay authenticates the tenant and forwards
the encrypted request. The Exit decrypts and sanitizes the request, calls the
LLM provider, then encrypts padded response frames for the Sidecar.

The Relay knows the tenant but cannot read the prompt. The Exit reads the prompt
but does not receive the tenant identity. The LLM provider receives the
sanitized plaintext request.

Read the blog here https://meshan.dev/blog/coffee-codex-shallot

## Run it locally

The local stack starts the Sidecar, Relay, Exit, and deterministic mock provider.
It creates an Exit key pair in `.shallot/keys` when needed.

```sh
bun install --frozen-lockfile
bun run dev:local
```

Send a request through the Sidecar from another terminal:

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

Set `LLM_PROVIDER_URL` and `LLM_PROVIDER_API_KEY` before `bun run dev:local` to
point Exit at a real OpenAI-compatible provider. The mock provider runs when
`LLM_PROVIDER_URL` is unset.

Use the Sidecar with Vercel AI SDK:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const shallot = createOpenAICompatible({
  name: "shallot",
  baseURL: "http://127.0.0.1:8788/v1",
  apiKey: "tenant-local",
});

const result = await generateText({
  model: shallot.chatModel("mock-text"),
  prompt: "Say hello",
});
```

## Testing

Run formatting checks, type checks, and all tests:

```sh
bun run check
```

Run only the Vercel AI SDK end-to-end tests:

```sh
bun run test:e2e
```

The tests use the local mock provider. They do not require an API key or a paid
model.

## Debug

See [docs/debug.md](docs/debug.md) for VS Code breakpoints, Effect DevTools,
and privacy-aware debug logs.

## Security

The Relay and Exit must not share records, operators, or infrastructure. If
they collude, they can link a tenant to a prompt. Timing, request order, and
response size can also leak associations.

Shallot uses RFC 9180 HPKE with X25519, HKDF-SHA-256, and AES-256-GCM. The Exit
uses a static recipient key, so recorded requests do not have forward secrecy if
that private key is later compromised.

Read [docs/security.md](docs/security.md) for the threat model and limits. Read
[docs/separate-machines.md](docs/separate-machines.md) to run the trust domains
on separate hosts. Open [docs/flow.html](docs/flow.html) for the animated flow.
