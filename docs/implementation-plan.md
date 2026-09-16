# Shallot implementation plan

## Goal

Build a working proof of concept for an AI gateway with a split trust model:

- The Relay authenticates the tenant but cannot read the AI request or response.
- The Exit reads the AI request and calls the provider but receives no tenant identity.
- The provider receives the plaintext request because it must run inference.
- The sidecar gives applications an OpenAI-compatible endpoint and handles all client-side cryptography.

The final acceptance test will use the Vercel AI SDK with the sidecar URL. It will run without paid APIs, external accounts, or network access after dependencies have been installed.

## Scope

The first complete version will support `POST /v1/chat/completions` for:

- Non-streaming text responses
- Streaming text responses
- System and multi-turn messages
- Tool definitions, tool calls, and tool results
- JSON response formats used by AI SDK structured output
- Provider errors, cancellation, timeouts, and client disconnects

Images, audio, embeddings, the OpenAI Responses API, and provider-specific options will remain out of scope until the chat completion path passes every acceptance test. Each later endpoint should get a separate wire contract and test suite.

## System design

```text
Vercel AI SDK
      |
      | OpenAI-compatible HTTP on localhost
      v
Client sidecar
      |
      | tenant authorization header
      | HPKE request envelope
      v
Relay
      |
      | service authentication only
      | unchanged HPKE envelope
      v
Exit
      |
      | sanitized OpenAI request
      | provider credential
      v
AI provider or local mock provider
```

The Relay and Exit will run as separate services. They will have separate keys, configuration, logs, and network identities. Running both in one process remains useful for tests, but it does not demonstrate the intended deployment boundary.

### Package layout

```text
packages/
  client/          Local sidecar
  protocol/        Wire schemas, HPKE operations, framing, and validation
  relay/           Tenant authentication and opaque forwarding
  exit/            Decryption, sanitization, provider calls, and encryption
  mock-provider/   Deterministic OpenAI-compatible test provider
  e2e/             AI SDK acceptance tests and process orchestration
```

Each package will expose a small public API through `index.ts`. Executables will live in files named for the process, such as `sidecar.ts`, `relay.ts`, `exit.ts`, and `mock-provider.ts`. Parsing, authentication, provider calls, frame processing, and configuration will stay in separate modules.

## Threat model

### Protected data

The design protects:

- Tenant identity and tenant credentials
- Prompt and message contents
- Tool definitions and tool arguments
- Model output
- Provider credentials

### Trust assumptions

The privacy claim depends on these assumptions:

1. The sidecar and client application are trusted. They already know the tenant and plaintext.
2. The Relay and Exit do not collude. If they combine their request records, they can associate a tenant with a prompt.
3. The Exit public key configured in the sidecar is authentic. A substituted key lets the substituting party decrypt requests.
4. The Exit does not receive tenant-specific headers, query parameters, cookies, tracing identifiers, or credentials.
5. The provider is allowed to read the prompt and response.
6. TLS protects every network connection in a deployed environment. HPKE does not replace transport security, service authentication, or denial-of-service controls.

### What each party learns

| Party | Learns | Must not receive |
| --- | --- | --- |
| Sidecar | Tenant credential, request, response, Exit public key | Exit private key, provider credential |
| Relay | Tenant identity, request time, padded sizes, frame count, connection duration | Plaintext prompt, tools, model output, provider credential |
| Exit | Plaintext request, selected model, provider response, traffic timing | Tenant credential, tenant ID, tenant-specific tracing data, client IP |
| Provider | Sanitized plaintext request, Exit network identity | Tenant credential, Relay authentication data |

### Attacks covered

- A passive observer cannot read application data when TLS and HPKE are both in use.
- A compromised Relay cannot decrypt recorded requests or responses without the relevant private keys.
- A compromised Exit can read request contents but should see all requests as coming from the Relay service.
- HPKE authentication detects changes to encrypted requests and response frames.
- Authenticated sequence numbers detect missing, reordered, duplicated, and modified response frames.
- An Exit replay cache rejects repeated request envelopes during a configured time window.
- Request limits, authentication, and timeouts limit resource use before the Relay forwards a request.

### Attacks not covered

- Relay and Exit collusion defeats the identity and content separation.
- A compromised sidecar or client application sees both identity and plaintext.
- The provider sees plaintext and may retain it under its own policy.
- Prompt text may identify the tenant. Removing a top-level `user` field cannot anonymize names, account numbers, or other identifiers written inside messages.
- Padding does not hide request timing, response duration, frame count, or the padded size bucket.
- HPKE base mode does not authenticate the sender. The Relay authenticates the tenant, and the Exit separately authenticates the Relay service.
- Compromise of the Exit's static private key permits decryption of previously recorded request envelopes. HPKE base mode with a static recipient key does not provide forward secrecy for those requests.
- JavaScript does not offer reliable control over memory erasure. The code will release references to private keys and plaintext as soon as possible, but it cannot prove that the runtime erased every copy.

### Operational rules

The Relay and Exit must not share distributed trace IDs. Neither service may log authorization headers, encrypted bodies, decrypted bodies, prompts, tool arguments, or provider responses. Metrics may include status classes, byte counts, durations, and failure categories. Relay and Exit logs should use separate local correlation values so an operator cannot join them by one shared request ID.

Production deployment should place Relay and Exit under separate service identities and administrative access. A stronger deployment would use separate infrastructure accounts or operators. The proof of concept will document this requirement but cannot prove organizational separation.

## Cryptographic protocol

The protocol will use RFC 9180 HPKE through `@hpke/core` with this cipher suite:

- DHKEM using X25519 and HKDF-SHA256
- HKDF-SHA256
- AES-256-GCM
- HPKE base mode

The library supports Bun and tests against RFC 9180 vectors, but its maintainers state that it has not received a formal security audit. The project will pin its exact version, retain the lockfile, run dependency audits, and keep the protocol small. A production release still needs an independent cryptographic review. See the [HPKE library documentation](https://github.com/dajiaji/hpke-js) and [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180).

### Exit key handling

The Exit owns a static X25519 key pair. The private key exists only in the Exit. The sidecar receives a pinned public key and key ID through configuration.

The request envelope will include the key ID. The Exit will support the current key and a bounded set of previous keys during rotation. Unknown key IDs will fail with a generic protocol error. The repository will include a Bun script that generates the key pair and writes files with restrictive permissions for local development.

The proof of concept will use explicit key configuration. It will not fetch an unauthenticated public key from the Relay. A later key-discovery endpoint would need a separate signing key or another authenticated distribution method.

### Request encryption

For each request, the sidecar will:

1. Generate a fresh HPKE sender context for the Exit's public key.
2. Generate a separate ephemeral X25519 key pair for the response stream.
3. Pad the serialized OpenAI request to a configured bucket size.
4. Authenticate the protocol version, request ID, key ID, and response public key as HPKE additional data.
5. Send the encapsulated key, response public key, and ciphertext to the Relay.

The Relay forwards the envelope without parsing or changing cryptographic fields.

### Response encryption

The Exit will create one HPKE sender context with the response public key supplied by the sidecar. It will split the provider's response byte stream into fixed-capacity plaintext frames. Each encrypted frame authenticates:

- The protocol version
- The request ID
- The frame sequence number
- The final-frame flag
- The response record type

The first encrypted response record will carry the upstream HTTP status and an allowlisted content type. Data records will carry raw provider response bytes. The sidecar will reconstruct the HTTP response without exposing the status or provider error body to the Relay.

After the Exit accepts an encrypted request, its Relay-facing HTTP response will use one generic success status. The real provider status will exist only inside the encrypted response record. Errors that occur before the Exit can establish a response context will use a small set of generic protocol statuses.

The Exit will flush a frame when it fills or when a short timer expires. Every encrypted data frame will use the configured padded size. This preserves streaming latency while hiding individual provider chunk sizes. The frame count and flush timing remain visible.

### Replay protection

The Exit will reject a previously accepted request envelope. The replay key will cover the Exit key ID and HPKE encapsulated key. The local proof of concept can use an in-memory time-bounded cache. The cache interface will allow a shared store in a multi-instance deployment.

The Relay will also reject duplicate client request IDs per tenant. This protects clients from accidental retries, but the Exit replay check remains necessary because the Relay itself is not trusted with plaintext confidentiality.

### Protocol limits

The protocol parser will enforce limits before allocation or decryption:

- Maximum encoded envelope size
- Maximum ciphertext size
- Exact HPKE encapsulated-key and X25519 public-key lengths
- Maximum NDJSON line length
- Maximum frame count and response bytes
- Strict version and field validation

Unknown fields will either be rejected or explicitly ignored according to the versioned schema. The choice will be documented per message type.

## Relay implementation

The Relay will contain these modules:

```text
src/
  relay.ts              Bun server and route orchestration
  config.ts             Environment parsing
  tenant-auth.ts        Bearer-token verification
  request-limits.ts     Rate, body-size, and concurrency limits
  exit-client.ts        Allowlisted forwarding to the Exit
  errors.ts             Stable OpenAI-compatible errors
  index.ts              Public exports only
  main.ts               Executable entry point
```

For the proof of concept, tenant authentication will use configured bearer tokens. The Relay will compare token hashes in constant time and attach no tenant value to the Exit request. The Relay-to-Exit request will use a separate service credential. A deployed version should replace that credential with mutual TLS or workload identity.

The Relay will forward only these values:

- The sealed request envelope
- A generic protocol version
- Relay service authentication
- Transport headers required for streaming

It will not forward client headers, client IP headers, cookies, query parameters, user agents, or trace context.

## Exit implementation

The Exit will contain these modules:

```text
src/
  exit.ts               Bun server and route orchestration
  config.ts             Keys, provider URL, limits, and timeouts
  relay-auth.ts         Relay service authentication
  request-opener.ts     Envelope validation, replay check, and HPKE open
  sanitize-request.ts   OpenAI request schema and identifier removal
  provider-client.ts    Fixed-destination provider HTTP client
  response-sealer.ts    Status record, padding, and encrypted frames
  replay-cache.ts       Replay-cache interface and local implementation
  errors.ts             Encrypted and pre-decryption errors
  index.ts              Public exports only
  main.ts               Executable entry point
```

The provider URL will come from trusted configuration, never from the encrypted request. This prevents server-side request forgery. The Exit will use an allowlist of model IDs and request fields.

The sanitizer will remove known identity fields such as `user` and provider-specific metadata fields. It will preserve message text and tool arguments because changing those values changes the model request. Tests will prove that removed values never reach the provider. Documentation will state that the sanitizer cannot remove identifiers embedded in natural-language content.

The Exit will never pass provider response headers through wholesale. It will permit only the status code and required content type. Provider request IDs, cookies, rate-limit headers, and internal diagnostics will stay at the Exit.

## Sidecar completion

The sidecar already owns the OpenAI-compatible client endpoint and HPKE operations. The remaining work will add:

- Exit key IDs and rotation support
- Strict content-type and request-schema validation
- Encrypted response status records
- Maximum frame and response limits
- Cancellation and backpressure propagation
- Stable error mapping for AI SDK clients
- Shutdown handling and readiness state

The sidecar will bind to loopback by default. Listening on a non-loopback address will require an explicit configuration setting because any local network client could otherwise submit requests with the tenant credential held by the sidecar.

## No-cost model strategy

### Required test provider

The acceptance suite will use a local deterministic OpenAI-compatible mock provider. It will be a real HTTP server behind the Exit, not an in-process AI SDK model mock. This matters because the test must exercise every network hop, request transformation, SSE parsing, frame boundary, and cancellation path.

The mock provider will support scripted behavior:

- Fixed JSON chat completion
- SSE completion split at arbitrary byte boundaries
- Tool call responses
- Structured JSON responses
- Delayed chunks and cancellation detection
- Configured HTTP errors
- Malformed SSE and abrupt disconnects

It will record the request it received through an injected test recorder. Tests will use that recorder to prove that tenant markers and stripped identity fields never reached the provider.

The AI SDK also has `MockLanguageModelV3` and stream test helpers, but those mocks bypass the sidecar URL and the OpenAI-compatible HTTP path. They are useful for isolated application tests, not the gateway acceptance test. See the [AI SDK testing documentation](https://ai-sdk.dev/docs/ai-sdk-core/testing).

### Optional local model

Ollama can provide a manual smoke test with a local model and no API charges. Its OpenAI-compatible endpoint supports `/v1/chat/completions`, streaming, tools, and JSON mode. It requires installing Ollama and downloading a model, so it will remain optional. See [Ollama's OpenAI compatibility documentation](https://docs.ollama.com/api/openai-compatibility).

The deterministic mock remains the release gate. A model's non-deterministic output should not decide whether the gateway passes CI.

## AI SDK acceptance test

The end-to-end package will install `ai` and `@ai-sdk/openai-compatible`. The official OpenAI-compatible provider accepts a custom `baseURL`, so the test can point it at the sidecar's `/v1` path. See the [AI SDK OpenAI-compatible provider documentation](https://ai-sdk.dev/providers/openai-compatible-providers).

The core test will look like this:

```ts
const shallot = createOpenAICompatible({
  name: "shallot",
  baseURL: `${sidecarUrl}/v1`,
  apiKey: tenantToken,
});

const generated = await generateText({
  model: shallot("mock-model"),
  prompt: "prompt-canary: return the configured response",
});

const streamed = streamText({
  model: shallot("mock-model"),
  prompt: "prompt-canary: stream the configured response",
});
```

The test will start the mock provider, Exit, Relay, and sidecar on ephemeral loopback ports. It will generate temporary keys and credentials. It will then call `generateText` and `streamText` through the AI SDK and assert the exact output.

The test will use unique markers:

- A tenant marker appears only in the AI SDK authorization token and Relay recorder.
- A prompt marker appears in the decrypted Exit request and provider request but never in the Relay request body.
- A removable user marker appears in the decrypted Exit request but never in the provider request.
- A response marker appears at the mock provider and AI SDK result but never as plaintext at the Relay.

This gives concrete evidence for the intended data split without claiming that a test proves the absence of every side channel.

## Test plan

### Protocol tests

- Round trips for request envelopes and multi-frame responses
- Every padding boundary around a block size
- Wrong Exit key and wrong response key
- Modified version, key ID, request ID, sequence, final flag, and ciphertext
- Truncated and malformed base64url values
- Missing, duplicated, reordered, and post-final frames
- Request replay
- Key rotation with current, previous, and unknown key IDs
- Property tests over payload sizes and frame splits
- Published HPKE vectors where the library API permits deterministic inputs

### Service tests

- Relay accepts valid tenant credentials and rejects invalid credentials
- Relay forwards no client header except the sealed body
- Exit rejects requests without Relay authentication
- Exit strips configured identity fields
- Exit never accepts a provider URL from request data
- Every timeout and size limit returns the documented error
- Client cancellation reaches the provider request
- Slow consumers apply backpressure instead of buffering an unbounded response
- Logs and test recorders contain no forbidden fields

### End-to-end tests

- AI SDK `generateText` through all four HTTP services
- AI SDK `streamText` with provider chunks split inside UTF-8 characters and SSE records
- Tool-call response and tool-result follow-up
- Structured JSON output
- Provider 400, 401, 429, and 500 responses returned as encrypted errors
- Provider disconnect during a stream
- Tampered request and response traffic
- Relay replay of a valid request
- Concurrent requests from two tenants with crossed timing
- Sidecar, Relay, and Exit shutdown during active requests

### Quality checks

The root `check` command will run formatting, linting, TypeScript, unit tests, integration tests, and the no-cost AI SDK acceptance test. CI will use `bun install --frozen-lockfile`.

The code rules will include:

- No `any` in production code
- No unchecked type assertions at network boundaries
- Explicit limits for untrusted lengths and counts
- No side effects in barrel files
- One process entry point per executable package
- Dependency injection for clocks, random IDs, fetch, and recorders where tests need control
- Protocol and security modules receive branch-focused tests, including every rejection path
- Comments explain security invariants and non-obvious protocol choices, not syntax
- Documentation, errors, comments, and command output receive an `unslop` review for plain and specific language

The project will use one formatter and linter configuration across all packages. Public functions will have stable error types where callers need to distinguish failures. Internal errors will not expose provider bodies or cryptographic details across trust boundaries.

## Implementation order

1. Write the versioned wire specification and threat-model tests before changing service code.
2. Add encrypted response metadata, key IDs, strict limits, and replay protection to `@shallot/protocol`.
3. Build the deterministic mock provider.
4. Implement the Exit against the mock provider.
5. Implement the Relay with tenant and service authentication.
6. Finish the sidecar changes required by the updated wire protocol.
7. Add the AI SDK end-to-end package and make its deterministic test pass.
8. Add tampering, cancellation, timeout, concurrency, and resource-limit tests.
9. Add linting, coverage gates, startup documentation, and the optional Ollama smoke command.
10. Run a final threat-model review against the implemented code and record any remaining gaps.

Each step will leave the repository passing its current checks. Protocol changes will update the specification and test vectors in the same change.

## Completion criteria

The proof of concept is complete when one command:

1. Generates temporary Exit keys and service credentials.
2. Starts the mock provider, Exit, Relay, and sidecar on ephemeral ports.
3. Runs AI SDK non-streaming, streaming, tool-call, structured-output, error, and cancellation cases.
4. Verifies the tenant marker, prompt marker, stripped marker, and response marker at every allowed observation point.
5. Runs protocol tampering and replay tests.
6. Shuts down every server and exits with status zero.

The command will print a short report with test names and pass or fail status. It will not print prompts, credentials, ciphertexts, private keys, or provider responses.

## Decisions needed from the user

No account, API key, or paid model is required. I can implement the full local proof with these defaults:

- Static bearer tokens for tenant authentication
- A separate static Relay-to-Exit service token for local testing
- OpenAI Chat Completions compatibility only
- A deterministic local mock provider as the required test provider
- Optional Ollama support for a manual real-model smoke test
- One active Exit key plus one previous key during rotation tests
- In-memory rate limits and replay cache with interfaces for later shared stores

Before implementation, input would help on two product choices, but neither blocks a working proof:

1. Decide whether the first version must support tool calls and structured output. This plan includes both because the AI SDK commonly uses them.
2. Decide whether the Relay may learn the model name for model-specific quotas. The safer default keeps the model inside the encrypted request, so the Relay can enforce request, byte, and concurrency quotas but not model-specific quotas.

A production deployment plan will later need the intended tenant identity system, infrastructure provider, key-management system, and whether Relay and Exit have separate operators. Those choices are not needed for the local end-to-end proof.
