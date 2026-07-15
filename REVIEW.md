# Review Contract

Use this checklist for human, bot, and agent review. Findings should cite the concrete file and line, identify the violated contract, explain the risk, and propose the smallest sufficient correction.

## Blocking findings

Block the change when any of the following applies:

- Behavior or public type changes are not covered by tests at the appropriate boundary.
- Package exports, declarations, README examples, and implementation describe different public surfaces.
- Runtime code selects runners, models, profiles, workspaces, retry policy, or pipeline transitions instead of executing a resolved invocation.
- Public contracts expose provider SDK, orchestrator, DBOS, Prisma, Nest, GraphQL, MCP, or playbook-owned types.
- Events, terminal streams, diagnostics, or artifacts can grow without an explicit bound or reach a sink before redaction.
- The manager registry can mutate after construction, performs implicit latest/fallback lookup, or execution rereads it
  after snapshotting an exact definition digest.
- A live accepted invocation can deliver zero or multiple process-local terminal events, omit the completed record before
  delivery, or return different completed values through handle, lookup, wait, and event paths.
- Late recording failure strands result waiters, recursively retries a failed result commit, claims a missing `result.json`
  exists, mutates a successfully committed result after terminal-event append failure, or treats filesystem exactly-once as
  guaranteed.
- Successful output can be text, a JSON primitive/array, or a JSON object that was not validated against the consumer's
  draft 2020-12 schema.
- Completed records or subscriber queues are unbounded, active work can be evicted, or eviction/unknown semantics disagree
  across manager methods.
- Output recording adopts an existing leaf, allows two concurrent owners, replaces `result.json`, depends on unsupported
  atomic-link behavior without failing closed, deletes evidence, or omits bounded raw-response diagnostics.
- Definitions or accepted requests retain caller-owned JSON containers instead of canonical package-owned snapshots.
- Argument-template delivery is incoherent, generic parameters do not use exact own-property/canonical JSON rules, expansion
  is nondeterministic/unbounded, CLI flags are implicit, or missing values are silently omitted.
- `.scratch` is outside the invocation directory, weakly protected, cleaned before reap, silently retained after controlled
  cleanup failure, or treated as package-owned durable recovery state.
- A child inherits wholesale `process.env`, environment keys overlap, secret values are not registered with streaming
  redaction before spawn, credential-like names enter nonsecret inherit/variables, or unredacted carry buffers survive
  finalization.
- Version probing uses regex extraction, accepts non-strict SemVer or non-AND range syntax, leaves output unbounded, or fails
  to kill and reap on timeout.
- Limit validation omits minima, per-invocation <= manager relationships, idle <= wall, total argv, or terminal reservation.
- Native command-line and ACP adapters return incompatible outcome or observability contracts.
- A deep import, broad root barrel, dependency cycle, or reverse dependency bypasses the intended package DAG.
- Architecture configuration changes do not include a passing positive graph and temporary representative negative probes.
- New code uses `any`, `@ts-ignore`, an unchecked assertion, silent error swallowing, or an unbounded external payload.
- System mechanics and business decisions are mixed into an unreadable unit.
- A speculative abstraction or compatibility fallback is introduced without an approved requirement.
- Runtime source depends on tests, fixtures, generated output, build scripts, or repository tooling.
- A lint, format, type, test, coverage, package, or workflow failure is suppressed instead of fixed.
- A quality exception lacks an owner, rationale, and expiry or removal condition.
- Required verification is skipped without a concrete reason and residual-risk statement.
- CI, Sonar, or review threads contain unresolved valid findings.
- A release change can publish without an explicit release approval gate.

## Expected evidence

- `pnpm verify` passed on the reviewed head.
- Conditional checks from `VERIFICATION.md` were run or marked not applicable.
- CI passed on the same commit.
- Sonar Quality Gate and issue-level results were inspected when provider access was available.
- The packed artifact contains only the declared public files.
- ATTW, package-content validation, isolated ESM and strict TypeScript consumers, and deep-import denial use one exact
  package tarball created with an isolated temporary npm cache.
- Documentation changed whenever the public package contract changed.
