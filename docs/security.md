# Shallot security model

## Privacy claim

Shallot separates tenant authentication from prompt processing when the Relay
and Exit are independently operated and do not share data.

- The Relay authenticates the tenant and receives an HPKE request envelope. It
  cannot decrypt the request.
- The Exit decrypts the request and receives a Relay service credential. It does
  not receive the tenant credential or tenant ID.
- The provider receives the sanitized plaintext request because it performs the
  model inference.
- The Sidecar holds the private response key. The Relay receives encrypted,
  fixed-capacity response frames.

Relay and Exit collusion defeats this property. Relay records identify the
tenant. Exit records contain the plaintext request. Timing, request order,
connection duration, and sizes can also correlate a tenant and request. Run the
Relay and Exit under separate accounts, access controls, logs, and operators.

## Cryptography

The protocol uses RFC 9180 HPKE through `@hpke/core`:

- KEM: X25519 with HKDF-SHA-256
- KDF: HKDF-SHA-256
- AEAD: AES-256-GCM

The Sidecar pins the Exit public key and key ID. Each request creates a new HPKE
sender context and an ephemeral response key pair. Authenticated data binds the
protocol version, request ID, key ID, response public key, frame sequence, frame
type, and final marker. Changing a bound value or ciphertext causes decryption
to fail.

The protocol prefixes and pads request and response plaintexts before
encryption. Response frames have ordered sequence numbers and a final marker.
The Sidecar rejects missing, duplicate, reordered, modified, oversized, and
post-final frames.

## Limits

- HPKE base mode does not authenticate the client. The Relay authenticates the
  tenant bearer token. The Exit authenticates the Relay service token.
- The Exit uses a static recipient key. If its private key is compromised,
  recorded request envelopes can be decrypted.
- Padding hides exact payload length within a configured bucket. It does not
  hide timing, frame count, total padded size, model latency, or endpoints.
- Sanitization removes supported identity fields and drops unsupported fields.
  It cannot remove personal information written into prompt text, tool
  descriptions, schemas, or arguments.
- JavaScript and Bun do not guarantee that secret values are erased from memory.
- This proof of concept needs dependency review and an independent security
  review before production use.

## Service controls

Services bind to `127.0.0.1` by default. A deployment needs TLS on every network
hop. TLS protects transport metadata and service credentials that HPKE does not
cover.

The implementation checks token digests in constant time, limits request and
response sizes, enforces provider and model policy at Exit, and tracks replayed
requests. It does not forward client headers, cookies, client IP headers, or
trace context to Exit.

The replay caches exist in one process. A multi-instance deployment needs a
shared atomic store.

## Tests

The test suite exercises buffered and streaming text, tools, structured output,
provider errors, authentication, replay protection, padding, malformed protocol
values, response limits, backpressure, and cancellation through the whole path.
It also checks that tenant identity and plaintext prompts do not appear together
at the Relay or Exit boundaries.

Tests cannot prove organizational separation, prevent traffic analysis, audit
the cryptographic dependency, or validate a production deployment.
