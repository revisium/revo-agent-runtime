# ADR-0002: Add a process-local AgentManager consumer boundary

- Status: Accepted
- Date: 2026-07-15
- Refines: [ADR-0001](./0001-agent-runtime-boundary.md)

## Context

ADR-0001 defined a low-level, attempt-scoped invocation runtime that consumes an immutable runner pin. A consumer also
needs one package-owned API for listing available agents, probing installations, starting exact agent versions,
observing all or one invocation, cancelling work, and obtaining terminal results without rebuilding process and event
coordination in every host.

A mutable package-side catalog would make execution depend on registration timing and implicit version choice. Event-only
completion would let consumers miss terminal results. Durable workflow state inside the package would duplicate the
consumer's runs, steps, attempts, retry policy, and recovery model.

## Decision

Add a target `AgentManager` as the single consumer-facing composition boundary for v1.

The consumer passes every versioned `AgentDefinition` to `createAgentManager`. Construction validates the complete set,
computes each definition digest, and seals the registry. V1 has no registration, replacement, latest-version, or fallback
API. Multiple versions may coexist and every lookup and start uses exact `{ id, version }` identity.

Starting an invocation snapshots `{ agentId, agentVersion, definitionDigest }`. Execution uses that immutable snapshot and
never rereads the registry. The consumer supplies an opaque `invocationId`; Revo run, step, and attempt identifiers may be
included only as opaque metadata.

Construction canonical-serializes definitions, digests the exact RFC 8785 bytes, parses package-owned copies, and retains no
caller container references. Invocation acceptance likewise owns defensive copies of request JSON and the explicit ephemeral
environment. No child inherits wholesale `process.env`; credential values enter only through invocation secrets and join
streaming redaction before spawn. Explicit inherited and variable values are non-confidential and credential-like names are
rejected outside the secrets map.

The manager owns process-local active and retained-completed records. It supports synchronous filtered subscription for
all invocations or one invocation, exactly one process-local terminal `invocation.finished` delivery, cancellation, a
handle result promise,
late result lookup, waiting by id, and filtered invocation listing. Async iteration is deferred because a safe buffering
and backpressure contract is not yet required.

The completed registry uses bounded FIFO retention. Construction may lower the package default but cannot increase it.
When capacity is exceeded, the oldest completed record is evicted and becomes `unknown`; an evicted identifier may be
reused. Active records are never evicted. Durable indexing, retention, and restart recovery remain consumer responsibilities.

## Consequences

- Consumer code gets one package API for agent discovery, observation, execution, cancellation, and terminal results.
- Definition changes require constructing a new manager; an existing manager remains deterministic.
- `result()`, `waitForResult()`, completed `getResult()`, and process-local `invocation.finished` expose the same immutable completed
  result contract.
- A terminal event is a notification, not the only result storage mechanism.
- Process restart loses the in-memory registry. The consumer uses its durable workflow state and output directory to
  recover according to a future, separately specified recovery contract.
- Retries, scheduling, orchestration, workflow transitions, and cross-process fan-in stay outside this package.

## Rejected alternatives

- **Mutable registration in v1:** makes behavior depend on timing and complicates version retention.
- **Implicit latest version:** breaks replay and recovery determinism.
- **Events as the only completion channel:** allows late subscribers to lose the result.
- **Unbounded completed history:** creates a process memory leak.
- **Package-owned durable workflow store:** duplicates consumer state and couples the package to a persistence model.
- **AsyncIterable in v1:** introduces an unowned queue and backpressure contract.
