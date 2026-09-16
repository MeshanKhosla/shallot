# Benchmarks

The benchmark compares three paths to the same provider:

```text
Direct:      oha -> mock provider
Plain proxy: oha -> unencrypted proxy -> mock provider
Shallot:     oha -> sidecar -> Relay -> Exit -> mock provider
```

The plain proxy checks the tenant credential, substitutes the provider credential, and streams bytes without parsing or encryption. It represents a small conventional AI gateway. The mock provider performs no inference and adds no artificial delay.

Install `oha`, then run:

```sh
brew install oha
bun run benchmark
```

The latest checked-in run is in [`results.md`](./results.md).

Bun recommends `oha`, `bombardier`, or `http_load_test` for HTTP load tests because a slower client can cap the measured server throughput. This benchmark uses `oha` for both latency and throughput and uses `Bun.nanoseconds()` for total suite time. See [Bun's benchmarking documentation](https://bun.com/docs/project/benchmarking).

The defaults are:

- Request sizes: 256, 4,096, 32,768, 262,144, and 1,048,576 bytes
- Latency: 300 requests per path at concurrency 1
- Throughput: up to 10,000 requests per path at concurrency 32
- Throughput input budget: 256 MiB per payload size and path
- Warmup: 50 requests per path
- Services: separate Bun processes on ports 18885 through 18889

The input budget reduces the request count for large prompts. This prevents a 1 MiB case from transferring 10 GiB through every path. Each result row includes its actual request count.

Override them with environment variables:

```sh
BENCH_LATENCY_REQUESTS=1000 \
BENCH_THROUGHPUT_REQUESTS=10000 \
BENCH_THROUGHPUT_BYTE_BUDGET=536870912 \
BENCH_CONCURRENCY=64 \
BENCH_PAYLOAD_BYTES=1024,1048576 \
bun run benchmark
```

Run benchmarks on an otherwise idle machine. Compare results from the same machine, power state, Bun version, and benchmark settings. The absolute numbers are not production capacity estimates because all services use loopback networking and the mock response is small.
