# performance-observability pack

Use this pack when work can change user-facing latency, payload size, query
count, database access, cache behavior, runtime pooling, or background
throughput.

Start Gates:
| Gate | Applies | Evidence |
|------|---------|----------|
| Performance pack selected | pending | pending |
| User-facing operation and owner identified | pending | Name the route, procedure, job, query, or command and its data/runtime owner |
| Budget and benchmark selected | pending | Use the owning budget and a deterministic baseline; do not loosen the threshold after measuring |
| Data volume and fan-out risk recorded | pending | Record cardinality, pagination, payload, query count, concurrency, and cold-start risks or N/A reasons |
| Production detector decision recorded | pending | Name the owning detector and privacy boundary, or record N/A |

Work Checklist:
- [ ] Performance pack: capture a before receipt before optimization when a reproducible regression exists.
- [ ] Performance pack: measure the complete user-facing operation, not one convenient inner query.
- [ ] Performance pack: record warm p50/p95, cold duration, payload bytes, and sample counts when the harness supports them.
- [ ] Performance pack: inspect query fan-out, result cardinality, pagination, and repeated reads before adding infrastructure.
- [ ] Performance pack: optimize the measured owner; do not add pooling, caches, indexes, or pagination without evidence that they own the miss.
- [ ] Performance pack: keep transaction-scoped database work serial unless the transaction owner explicitly supports parallel reads.
- [ ] Performance pack: performance evidence contains no SQL, inputs, headers, credentials, tenant/person identifiers, or protected data.
- [ ] Performance pack: add or extend a deterministic regression harness when the changed path lacked one.
- [ ] Performance pack: record every budget override with baseline, owner, reason, and expiry; permanent unexplained exceptions are forbidden.

Completion Gates:
| Gate | Applies | Required action | Evidence |
|------|---------|-----------------|----------|
| Warm latency budget | pending | Prove the changed operation stays within its p95 budget using the owning harness | pending |
| Cold and failure paths | pending | Measure cold behavior and prove failure handling remains owned; do not classify no traffic as healthy | pending |
| Payload and fan-out | pending | Record payload bytes plus query/fan-out/cardinality evidence; add pagination or bounded reads when the measured owner needs them | pending |
| Before/after receipt | pending | Record comparable baseline and final evidence, or N/A when no regression/optimization occurred | pending |
| Detector and privacy | pending | Prove the owning runtime detector covers the changed operation without protected data, or record N/A | pending |
| Performance regression check | pending | Run the deterministic performance harness and relevant checks in the owning workspace | pending |
