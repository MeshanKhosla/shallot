# Shallot benchmark results

- Recorded: 2026-09-16T14:33:49.974Z
- Bun: 1.4.2
- Platform: darwin arm64
- CPU: Apple M4
- Latency samples: 300 per path at concurrency 1
- Throughput samples: 10000 per path at concurrency 32
- Total benchmark time: 11.92 seconds
- Provider: deterministic local mock with no inference or artificial delay

## Latency

| Request bytes | Direct p50 | Shallot p50 | Added p50 | Direct p95 | Shallot p95 | Added p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | 0.03 ms | 0.90 ms | 0.87 ms | 0.04 ms | 1.50 ms | 1.46 ms |
| 4096 | 0.03 ms | 0.91 ms | 0.87 ms | 0.05 ms | 1.63 ms | 1.58 ms |
| 32768 | 0.04 ms | 1.04 ms | 1.00 ms | 0.07 ms | 1.82 ms | 1.75 ms |

## Throughput

| Request bytes | Direct req/s | Shallot req/s | Shallot / direct | Reduction |
| ---: | ---: | ---: | ---: | ---: |
| 256 | 139699 | 3661 | 0.03x | 97.4% |
| 4096 | 129282 | 3596 | 0.03x | 97.2% |
| 32768 | 90671 | 2712 | 0.03x | 97.0% |

The direct baseline and Shallot path call the same local mock provider. The added latency therefore measures local HTTP hops, authentication, parsing, padding, HPKE work, and framing. Absolute results vary by machine and background load.
