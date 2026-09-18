# Effect server migration

Shallot uses Effect 4 at the four HTTP server boundaries while keeping the
protocol and cryptographic code independent. Fetch `Request` and `Response`,
Web Streams, and `Bun.serve` remain the external adapters.

## Dependency graph

```text
Sidecar runtime
  Sidecar request handler -> RelayClient -> RelayTransport

Relay runtime
  Relay request handler -> TenantAuthenticator
                        -> RequestTracker -> Clock
                        -> ConcurrencyLimiter
                        -> ExitClient -> ExitTransport
                        -> RelayObserver

Exit runtime
  Exit request handler -> ReplayProtection -> Clock
                       -> LlmProvider

Exit application composition
  OpenAI-compatible LlmProvider -> ProviderTransport

Mock provider runtime
  Mock provider request handler
```

Server configuration contains data such as addresses, service credentials,
limits, and cache policy. It does not contain live service implementations.
Each server has one production Layer constructor, and tests replace that Layer
when they need a fake provider, transport, clock, authenticator, tracker,
observer, or replay protection. Pure validation, sanitization, authentication
comparisons, and response transformations remain plain functions unless they
need injected state or cancellation. Mock provider response functions stay
plain because they have no service dependencies.

The Exit server depends only on the abstract `LlmProvider` service. Provider
connection settings and policy belong to that service. The application entry
point is the only module that loads the default OpenAI-compatible provider and
combines its Layer with the Exit replay Layer. A different provider can replace
that Layer without changing `ExitConfig`, `exit.ts`, or the request handler.

The three outbound HTTP adapters receive their fetch and timeout behavior from
transport Layers. Relay test observations also come from a Layer, with a no-op
implementation in production. This leaves one dependency-injection mechanism
for request processing. Replay expiry reads Effect's `Clock`, so tests can move
time without adding clock callbacks to production classes. Stateful replay and
request-tracking services allocate their caches when each Layer is built, so
separate server runtimes never share replay state.

## Runtime boundary

Each `create*Server` function builds one `ManagedRuntime` and reuses it for all
requests. The Bun `fetch` callback runs one request Effect with the incoming
request signal. A shared, idempotent lifecycle helper stops the Bun server and
then disposes the runtime. It still attempts runtime disposal if Bun shutdown
fails. Signal handlers await that sequence and record a controlled
`shutdown.failed` event if disposal fails.

```text
Bun HTTP adapter
  -> Effect request program
       -> services supplied by Layers
       -> typed failures before HTTP headers
  -> Web Stream response
       -> explicit cancellation, backpressure, and cleanup
```

Effect owns request processing until the handler produces a `Response`. Web
Streams own the response body after that point. Once Bun sends the response
headers, a stream failure cannot return through the request Effect's typed error
channel or replace the HTTP status. The stream instead errors its reader and
runs its explicit cancellation and cleanup paths. This is normal HTTP streaming
behavior, and keeping that boundary visible makes resource ownership easier to
audit.

Request programs return Fetch `Response` values. Expected failures stay in the
typed error channel until one HTTP translation function converts them to the
existing status, public message, and OpenAI-compatible error type. A defect is
converted only at that outer boundary and always uses the component's generic
500 response. The server records a random incident ID, component name, and
`request.defect` event before returning that response. The diagnostic reporter
never receives the cause object, so exception messages, ciphertext validation
details, plaintext, credentials, and keys cannot enter the default defect log.
Request interruption is not reported as a defect.

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
Once the Exit opens an HPKE envelope, it also seals request validation, replay,
and replay-capacity errors. Errors that occur before decryption remain plaintext
HTTP responses because the Exit does not yet have an authenticated response key.

Provider timeouts are a distinct, tagged error: the Exit seals a `504` with
`AI provider timed out` and the OpenAI-compatible `provider_error` type instead
of folding it into the old generic `502` umbrella. A provider response that
exceeds `maxResponseBytes` does not produce an HTTP error. The sealed
stream simply errors its reader partway, so the client sees an aborted encrypted
response rather than a successful one. The Relay and Sidecar map their own
upstream timeouts and transport failures to `502` independently; those statuses
describe Relay-or-Sidecar-to-upstream errors, not Exit-to-provider errors.

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
Stream backpressure. Web Stream code owns its readers and finalizers. Success,
failure, and downstream cancellation release locks, cancel unfinished upstream
bodies, and return Relay concurrency permits exactly once.

## Logging

The existing privacy-aware debug logger remains the request log sink because its
views enforce the current trust boundaries. Relay debug records may contain
tenant identity but never plaintext. Exit debug records may contain request
content but never tenant identity. No trace context is forwarded between Relay
and Exit.

The request programs do not add Effect log annotations or spans. Those records
had no configured sink and added work without changing the current debug logs.
Effect tracing belongs in a later change with a real backend and an explicit
policy for the metadata each machine may export.

## Intentionally outside Effect

`packages/protocol` remains unchanged and has no Effect dependency. HPKE, wire
parsers, padding, frame authentication, response metadata, and bounded protocol
helpers retain their current APIs and byte behavior. Fetch objects and Web
Streams remain at network boundaries. Request sanitization, constant-time token
comparison, byte queues, and deterministic mock response construction stay
plain where Effect would only add ceremony.
