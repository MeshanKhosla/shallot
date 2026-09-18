# @shallot/observability

This package contains Shallot's debug logger and formatting helpers.

Each server supplies an explicit view of what it can see. Relay logs may show a
tenant identity and ciphertext, while Exit logs may show plaintext and an
unknown tenant. Ciphertext previews show a short prefix followed by an
encrypted marker.

Logging is best effort. A failed debug sink cannot change request processing.
The server applications enable debug output through `SHALLOT_LOG_LEVEL=debug`.
