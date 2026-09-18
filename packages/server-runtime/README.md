# @shallot/server-runtime

This package contains Effect-based runtime code shared by Shallot's HTTP
servers.

It provides configuration validators, streamed-response deadlines, injectable
defect reporting, the Effect Platform Bun server adapter, test server scopes,
and the process runner. `BunRuntime.runMain` handles signals and closes the
server scope. The deadline stays active until a response body completes or its
consumer cancels.

Protocol and cryptographic code do not depend on this package.
