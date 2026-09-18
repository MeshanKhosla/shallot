# @shallot/relay

This package implements the Relay server. The Relay authenticates the tenant,
checks request IDs for replay, applies request limits, and forwards encrypted
requests to the Exit.

The Relay can see the tenant identity and encrypted request metadata. It cannot
decrypt the prompt or the response. It replaces the tenant credential with a
service credential before calling the Exit.

The package exports the Bun server factory, Effect application, tenant
authentication, request tracking, and observation services. Tests can replace
each service with an Effect Layer.
