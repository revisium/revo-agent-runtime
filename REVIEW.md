# Review Contract

Use this checklist for human, bot, and agent review. Findings should cite the concrete file and line, identify the violated contract, explain the risk, and propose the smallest sufficient correction.

## Blocking findings

Block the change when any of the following applies:

- Behavior or public type changes are not covered by tests at the appropriate boundary.
- Package exports, declarations, README examples, and implementation describe different public surfaces.
- Runtime code selects runners, models, profiles, workspaces, retry policy, or pipeline transitions instead of executing a resolved invocation.
- Public contracts expose provider SDK, orchestrator, DBOS, Prisma, Nest, GraphQL, MCP, Kubernetes, claim/lease, host, or
  playbook-owned types.
- Initialization is repeatable, performs process work before whole-input structural/duplicate validation, lets one row block
  independent valid rows, silently prunes unknown/mismatched pins, lacks operation/total timeouts, or does not fail closed on
  inspection/termination/sink uncertainty.
- Active snapshots contain results, terminal history, prompts, credentials, environment, output paths, or consumer workflow
  data; or the package reads a database instead of accepting consumer-loaded rows and a `save`/`remove` sink.
- A POSIX invocation that reaches `running` returns a handle before bounded fingerprint capture and active-state save;
  capture/save failure leaves a known process untracked; cancellation of an invocation with a saved `running` row signals
  before attempting the bounded `cancelling` save; a sink outage prevents live kill/reap; or removal failure changes
  invocation result semantics.
- Recovery signals by persisted PID/process-group id alone, accepts a fingerprint derived from caller-controlled data,
  signals or removes a live identity mismatch, treats consumer selection as package-proven ownership, signals after uncertain
  inspection, or claims descendant cleanup after the identity-matched leader is gone.
- Leader exit removes active state or finalizes before the owned group is confirmed descendant-free; unconfirmed group
  cleanup produces a terminal result, prunes the row, or omits typed `process_cleanup_failed` evidence.
- Shutdown before/during initialization can admit work, hang beyond the initialization deadline, or resolve without settling
  every recovery process already signalled.
- Events, terminal streams, diagnostics, or artifacts can grow without an explicit bound or reach a sink before redaction.
- The manager registry can mutate after construction, performs implicit latest/fallback lookup, or execution rereads it
  after snapshotting an exact definition digest.
- A live accepted invocation can deliver zero or multiple process-local terminal events, omit the completed record before
  delivery, or return different completed values through handle, lookup, wait, and event paths.
- Shutdown is not idempotent/concurrency-safe, admits a racing start outside its drain set, resolves without confirmed
  invocation/probe kill and reap, clears listeners before terminal delivery, rejects because an invocation failed, performs
  an independent completed-record clear/eviction pass, bypasses normal bounded FIFO, or deletes consumer output directories.
- Unconfirmed kill/reap does not reject the shared completion with bounded/redacted non-retryable
  `revo.agent.shutdown_failed`, a later shutdown observes a different settlement, or an affected invocation is falsely
  completed instead of remaining active, or consumer guidance permits same-domain replacement before cleanup resolves.
- A closed or shutdown-failed manager accepts a new start/probe/subscription, makes registry/state reads or existing handles
  unusable, or reports closure with anything other than the stable bounded `revo.agent.manager_closed` fault.
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
- Limit validation omits active-operation/initialization minima and relationship, per-invocation <= manager relationships,
  idle <= wall, total argv, or terminal reservation.
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
