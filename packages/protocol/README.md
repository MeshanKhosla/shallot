# @shallot/protocol

This package defines Shallot's encrypted wire protocol. It has no dependency on
the HTTP servers or Effect.

It contains:

- HPKE request sealing and opening with X25519
- Encrypted response frame sealing and opening
- Payload padding
- Wire validation and protocol version fields
- Response metadata encoding
- Bounded HTTP body reading and shared protocol constants

The package works with bytes and protocol values. Tenant authentication,
provider calls, logging, and server configuration belong to other packages.
