# Shallot benchmark results

- Recorded: 2026-09-19T20:03:34.894Z
- Bun: 1.4.2
- Platform: darwin arm64
- CPU: Apple M4
- Latency samples: 300 per path at concurrency 1
- Throughput samples: up to 10000 per path at concurrency 32
- Total benchmark time: 26.91 seconds
- Provider: deterministic local mock with no inference or artificial delay

## Latency

| Request bytes | Direct p50 | Plain proxy p50 | Shallot p50 | Shallot vs proxy | Direct p95 | Plain proxy p95 | Shallot p95 | Shallot vs proxy |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 0.13 ms | 0.16 ms | 2.32 ms | 2.16 ms | 0.36 ms | 0.32 ms | 4.63 ms | 4.31 ms |
| 4096 | 0.07 ms | 0.11 ms | 1.29 ms | 1.18 ms | 0.10 ms | 0.16 ms | 2.32 ms | 2.16 ms |
| 32768 | 0.07 ms | 0.13 ms | 1.47 ms | 1.34 ms | 0.11 ms | 0.18 ms | 2.51 ms | 2.33 ms |
| 262144 | 0.11 ms | 0.18 ms | 2.95 ms | 2.77 ms | 0.18 ms | 0.27 ms | 5.67 ms | 5.40 ms |
| 1048576 | 0.30 ms | 0.43 ms | 7.59 ms | 7.16 ms | 0.70 ms | 0.80 ms | 10.62 ms | 9.81 ms |

## Throughput

| Request bytes | Requests/path | Direct req/s | Plain proxy req/s | Shallot req/s | Shallot / proxy |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 10000 | 27959 | 30517 | 2310 | 0.08x |
| 4096 | 10000 | 33683 | 31114 | 2413 | 0.08x |
| 32768 | 8192 | 27769 | 23976 | 1770 | 0.07x |
| 262144 | 1024 | 12874 | 7572 | 774 | 0.10x |
| 1048576 | 256 | 3195 | 2555 | 275 | 0.11x |

All three paths call the same local mock provider. The plain proxy authenticates the tenant, replaces the provider credential, and streams the request and response without parsing or encryption. The Shallot versus proxy columns isolate the extra process hops, parsing, padding, HPKE work, and framing. Absolute results vary by machine and background load.
