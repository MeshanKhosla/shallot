# @shallot/exit

This package implements the Exit server. The Exit authenticates the Relay,
opens the HPKE request envelope, removes unsupported and identifying request
fields, and calls the configured LLM provider.

The Exit can see the prompt but receives no tenant identity from the Relay. It
encrypts provider responses into padded frames that only the Sidecar can open.

The package exports the server factory, Effect application, `LlmProvider`
service, OpenAI-compatible provider adapter, request policy, and
configuration. A different provider can implement `LlmProvider` without
changing the Exit server.
