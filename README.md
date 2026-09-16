# Shallot

_Onion routing for your AI gateway_

Shallot is a proof-of-concept AI gateway split in two so that no single service sees both who sent a prompt and what it says. It exposes an OpenAI Chat Completions endpoint that works with the Vercel AI SDK.

The client sidecar encrypts requests to the Exit. The Relay authenticates the tenant and forwards the opaque request. The Exit decrypts and sanitizes it, calls a configured AI provider, and encrypts padded response frames back to the sidecar.

## Test it

The complete test suite uses a deterministic local provider. It needs no API key, external service, or paid model.

```sh
bun install --frozen-lockfile
bun run check
```

The end-to-end tests use the real `ai` and `@ai-sdk/openai-compatible` packages over HTTP:

```sh
bun run test:e2e
```

## Run the local stack

Generate an X25519 Exit key pair. The private file is created with mode `0600`, is ignored by Git, and is never printed.

```sh
bun run keygen
```

Start each trust domain in a separate terminal from the repository root:

```sh
MOCK_PROVIDER_API_KEY=provider-local bun packages/mock-provider/src/main.ts
```

```sh
EXIT_PRIVATE_KEY="$(<.shallot/keys/exit-private.key)" \
EXIT_RELAY_TOKEN=relay-to-exit-local \
EXIT_PROVIDER_API_KEY=provider-local \
bun packages/exit/src/main.ts
```

```sh
RELAY_TENANT_TOKENS=demo:tenant-local \
RELAY_EXIT_TOKEN=relay-to-exit-local \
bun packages/relay/src/main.ts
```

```sh
SIDECAR_EXIT_PUBLIC_KEY="$(<.shallot/keys/exit-public.key)" \
bun packages/client/src/main.ts
```

Point an OpenAI-compatible AI SDK provider at the sidecar:

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

## Security boundary

The privacy property requires the Relay and Exit not to collude. The Relay learns tenant identity and traffic metadata. The Exit and upstream provider see the sanitized plaintext request, and the provider sees requests as coming from the Exit. If Relay and Exit records are combined, or timing is correlated, they can associate a tenant with a request.

Shallot uses RFC 9180 HPKE with X25519/HKDF-SHA-256, HKDF-SHA-256, and AES-256-GCM. The static Exit recipient key does not provide forward secrecy if that private key is later compromised. This POC is not a substitute for an independent security review.

See [the security model](docs/security.md) for precise guarantees and limitations, and [the implementation plan](docs/implementation-plan.md) for design detail.
