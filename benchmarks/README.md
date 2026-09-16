# Benchmarks

The benchmark compares an immediate local provider request with the same request through the full Shallot path:

```text
Direct:  oha -> mock provider
Shallot: oha -> sidecar -> Relay -> Exit -> mock provider
```

The mock provider performs no inference and adds no artificial delay. The difference measures local HTTP, authentication, parsing, padding, HPKE, and response framing overhead.

Install `oha`, then run:

```sh
brew install oha
bun run benchmark
```

The latest checked-in run is in [`results.md`](./results.md).

Bun recommends `oha`, `bombardier`, or `http_load_test` for HTTP load tests because a slower client can cap the measured server throughput. This benchmark uses `oha` for both latency and throughput and uses `Bun.nanoseconds()` for total suite time. See [Bun's benchmarking documentation](https://bun.com/docs/project/benchmarking).

The defaults are:

- Request sizes: 256, 4,096, and 32,768 bytes
- Latency: 300 requests per path at concurrency 1
- Throughput: 10,000 requests per path at concurrency 32
- Warmup: 50 requests per path
- Services: separate Bun processes on ports 18885 through 18888

Override them with environment variables:

```sh
BENCH_LATENCY_REQUESTS=1000 \
BENCH_THROUGHPUT_REQUESTS=10000 \
BENCH_CONCURRENCY=64 \
BENCH_PAYLOAD_BYTES=1024,16384 \
bun run benchmark
```

Run benchmarks on an otherwise idle machine. Compare results from the same machine, power state, Bun version, and benchmark settings. The absolute numbers are not production capacity estimates because all services use loopback networking and the mock response is small.
