# Shallot security model

## Privacy claim

Shallot separates tenant authentication from prompt processing when the Relay and Exit are independent and do not cooperate:

- The Relay authenticates the tenant and handles an HPKE request envelope it cannot decrypt.
- The Exit decrypts the request but receives only a Relay service credential, never the tenant credential or tenant ID.
- The provider receives the sanitized plaintext because it must perform inference.
- The Relay sees encrypted, fixed-capacity response frames. The sidecar alone holds the private response key.

This is a non-collusion design. Cooperation between the Relay and Exit defeats the separation: Relay records identify the tenant, while Exit records contain the plaintext. Timing, sizes, request order, and connection duration also permit correlation even without explicit shared identifiers. Deployments that need this property should use separate infrastructure accounts, access controls, logs, and operators for the two services.

## Cryptography

The protocol uses RFC 9180 HPKE base mode through `@hpke/core`:

- KEM: X25519 with HKDF-SHA-256
- KDF: HKDF-SHA-256
- AEAD: AES-256-GCM

X25519 is a standard elliptic-curve Diffie-Hellman construction with compact keys and broad interoperable support. HPKE supplies the key schedule, domain separation, authenticated encryption, and encapsulated-key format that a hand-built X25519 scheme would otherwise need to implement correctly.

The sidecar pins the Exit public key and key ID. Each request creates a fresh HPKE sender context and a separate ephemeral response key pair. Additional authenticated data binds the protocol version, request ID, key ID, response public key, response sequence, frame type, and final-frame marker where applicable. Changing a bound value or ciphertext causes decryption to fail.

Request and response plaintexts are length-prefixed and padded before encryption. Response frames use ordered sequence numbers and a final marker. The sidecar rejects missing, duplicated, reordered, modified, oversized, and post-final records.

## Limits of the construction

- HPKE base mode does not authenticate the client. The Relay authenticates tenant bearer tokens; the Exit independently authenticates the Relay service token.
- The Exit uses a static recipient key. Compromise of its private key permits decryption of recorded request envelopes, so requests do not have forward secrecy against later Exit-key compromise.
- The response uses an ephemeral client recipient key, but a compromised sidecar already has the plaintext and tenant identity.
- Padding hides exact payload lengths within a configured bucket. It does not hide timing, frame count, total padded size, model latency, or connection endpoints.
- Sanitization removes supported identity fields and drops unrecognized request, message, tool, tool-call, response-format, and stream-option fields. It cannot remove names, account numbers, or other identifiers written inside prompt text, tool descriptions, schemas, or arguments.
- JavaScript and Bun do not guarantee erasure of secret values from memory.
- `@hpke/core` is tested against RFC vectors by its maintainers but has not received a formal security audit according to its project documentation. Production use needs dependency review and an independent review of this protocol and deployment.

## Service controls

All services bind to `127.0.0.1` by default. A deployed system still requires TLS between every network hop. TLS protects transport metadata and service credentials that HPKE does not cover.

The implementation also enforces:

- Separate tenant, Relay-to-Exit, and provider credentials
- Constant-time comparison of configured bearer-token digests
- Fixed provider destination and optional model allowlist at the Exit
- Request, envelope, response, frame-count, concurrency, and timeout limits
- Relay request-ID and Exit encapsulated-key replay caches
- Allowlisted provider response metadata
- Backpressure and cancellation through the encrypted response path
- No forwarding of client headers, cookies, client IP headers, or trace context to the Exit

The bounded in-memory replay and request caches protect one process only. A multi-instance deployment needs shared, atomic stores. Static environment credentials are suitable for this local POC; production should use workload identity or mutual TLS and a managed key system.

## What the tests establish

The automated suite proves that the implemented HTTP path works with the Vercel AI SDK for buffered text, streaming text, tools, structured output, and provider errors. It checks authentication boundaries, nested sanitizer behavior, bounded replay tracking, padding boundaries, malformed wire values, wrong keys, authenticated-data tampering, response limits, backpressure, cancellation, and plaintext canaries on both sides of the Relay.

Tests can show that selected identity and plaintext canaries are absent at observed boundaries. They cannot prove organizational non-collusion, eliminate traffic analysis, audit the cryptographic dependency, or validate a future production deployment.
