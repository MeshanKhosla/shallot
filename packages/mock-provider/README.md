# @shallot/mock-provider

This package implements a deterministic OpenAI-compatible provider for local
development and tests. It lets the complete Shallot flow run without an API key
or paid model.

The provider supports text, streaming, tool-call, structured-output, and error
responses used by the end-to-end suite. Test hooks can observe provider
requests and client cancellation.

The local stack starts it on port `8785` by default. Production deployments
should configure the Exit to call a real LLM provider instead.
