# Shallot benchmark results

- Recorded: 2026-09-16T14:40:00.034Z
- Bun: 1.4.2
- Platform: darwin arm64
- CPU: Apple M4
- Latency samples: 300 per path at concurrency 1
- Throughput samples: up to 10000 per path at concurrency 32
- Total benchmark time: 19.41 seconds
- Provider: deterministic local mock with no inference or artificial delay

## Latency

| Request bytes | Direct p50 | Plain proxy p50 | Shallot p50 | Shallot vs proxy | Direct p95 | Plain proxy p95 | Shallot p95 | Shallot vs proxy |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 0.03 ms | 0.09 ms | 1.05 ms | 0.96 ms | 0.05 ms | 0.12 ms | 1.97 ms | 1.86 ms |
| 4096 | 0.04 ms | 0.08 ms | 0.87 ms | 0.79 ms | 0.05 ms | 0.11 ms | 1.38 ms | 1.27 ms |
| 32768 | 0.04 ms | 0.10 ms | 1.04 ms | 0.94 ms | 0.07 ms | 0.15 ms | 1.92 ms | 1.77 ms |
| 262144 | 0.08 ms | 0.15 ms | 2.57 ms | 2.42 ms | 0.17 ms | 0.23 ms | 3.82 ms | 3.59 ms |
| 1048576 | 0.18 ms | 0.33 ms | 7.09 ms | 6.76 ms | 0.33 ms | 0.55 ms | 8.90 ms | 8.35 ms |

## Throughput

| Request bytes | Requests/path | Direct req/s | Plain proxy req/s | Shallot req/s | Shallot / proxy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 10000 | 138577 | 55776 | 3634 | 0.07x |
| 4096 | 10000 | 128951 | 55147 | 3492 | 0.06x |
| 32768 | 8192 | 88565 | 43697 | 2676 | 0.06x |
| 262144 | 1024 | 21890 | 14539 | 986 | 0.07x |
| 1048576 | 256 | 4187 | 3017 | 279 | 0.09x |

All three paths call the same local mock provider. The plain proxy authenticates the tenant, replaces the provider credential, and streams the request and response without parsing or encryption. The Shallot versus proxy columns isolate the extra process hops, parsing, padding, HPKE work, and framing. Absolute results vary by machine and background load.
