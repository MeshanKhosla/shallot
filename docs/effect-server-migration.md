# Effect server migration

Shallot uses Effect 4 at the four HTTP server boundaries while keeping the
protocol and cryptographic code independent. Fetch `Request` and `Response`,
Web Streams, and `Bun.serve` remain the external adapters.

## Dependency graph

```text
Sidecar runtime
  Sidecar request handler -> RelayClient

Relay runtime
  Relay request handler -> TenantAuthenticator
                        -> RequestTracker
                        -> ConcurrencyLimiter
                        -> ExitClient

Exit runtime
  Exit request handler -> ReplayProtection
                       -> LlmProvider

Mock provider runtime
  Mock provider request handler
```

Configuration stays as immutable constructor input. Layers turn configured
implementations into replaceable services once per server. Pure validation,
sanitization, authentication comparisons, and response transformations remain
plain functions unless they need injected state or cancellation.

## Runtime boundary

Each `create*Server` function builds one `ManagedRuntime` and reuses it for all
requests. The Bun `fetch` callback runs one request Effect with the incoming
request signal. Server shutdown disposes the runtime so its fibers and scoped
resources are interrupted before the Bun server finishes stopping.

Request programs return Fetch `Response` values. Expected failures stay in the
typed error channel until one HTTP translation function converts them to the
existing status, public message, and OpenAI-compatible error type. A defect is
converted only at that outer boundary and always uses the component's generic
500 response. Internal causes, ciphertext validation details, plaintext,
credentials, and keys never enter public errors.

## Error taxonomy

The Sidecar models invalid routes or bodies, oversized bodies, Relay transport
failure, Relay rejection, empty Relay responses, and malformed encrypted
responses. The Relay models invalid routes or envelopes, tenant authentication,
replay, exhausted replay or concurrency capacity, Exit timeout or transport
failure, Exit rejection, and empty Exit responses. The Exit models invalid
routes or envelopes, Relay authentication, unknown keys, decryption or
sanitization failure, replay, exhausted replay capacity, provider timeout or
transport failure, and provider response limits. The mock provider models route,
authentication, and request-validation failures.

Provider HTTP error responses are successful transport results. The Exit seals
their status and body exactly as it does now. It does not retry provider calls.

## Cancellation and resources

```text
AI SDK disconnect
  -> Sidecar request fiber interrupted
  -> Relay fetch aborted
  -> Relay request fiber interrupted
  -> Exit fetch aborted and concurrency permit released
  -> Exit request fiber interrupted
  -> provider fetch and reader aborted
  -> response readers and counters finalized
```

`Effect.tryPromise` receives the fiber's `AbortSignal`, so interrupting a
request aborts the matching downstream fetch. Provider and service fetches
combine that signal with the client signal and an injected timeout signal. The
timeout stays attached after response headers arrive, which preserves the
existing limit across streamed response bodies. Tests control the timeout with
an injected `AbortController`. Stream adapters stay pull-based to preserve Web
Stream backpressure. Their readers use explicit finalizers so success, failure,
and downstream cancellation release locks, cancel unfinished upstream bodies,
and return Relay concurrency permits exactly once.

## Logging

Request Effects annotate logs and spans with the component and request ID after
that ID is available. The existing privacy-aware debug logger remains the sink
because its views enforce the current trust boundaries. Relay annotations may
contain tenant identity but never plaintext. Exit annotations may contain the
request ID and plaintext debug view but never tenant identity. No trace context
is forwarded between Relay and Exit.

## Intentionally outside Effect

`packages/protocol` remains unchanged and has no Effect dependency. HPKE, wire
parsers, padding, frame authentication, response metadata, and bounded protocol
helpers retain their current APIs and byte behavior. Fetch objects and Web
Streams remain at network boundaries. Request sanitization, constant-time token
comparison, byte queues, and deterministic mock response construction stay
plain where Effect would only add ceremony.
