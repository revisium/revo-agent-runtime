# ADR-0011: Define consumer-governed admission and local supervision

- Status: Accepted
- Date: 2026-07-31
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md),
  [ADR-0006](./0006-consumer-backed-active-invocation-recovery.md), and
  [ADR-0008](./0008-real-mechanics-supervision-boundary.md)
- Related: [ADR-0010](./0010-consumer-warranted-stable-output-ancestors.md)

## Context

The earlier decisions establish a process-local manager, consumer-backed active-process recovery, bounded completed retention,
and a real-mechanics supervision boundary. They deliberately defer active-invocation admission, listener fanout, workspace/CWD
policy, provider graceful-cancellation behavior, and supported platform/filesystem cells. The target specification consequently
still permits an active-state save to delay the first cancellation signal and uses a different POSIX grace interval.

The package must remain invocation-scoped. It must not become a workflow scheduler, a consumer-owned workspace authority, a
provider-specific cancellation engine, or a durable session manager. At the same time, persistence or an advisory provider
cancellation request must not delay authoritative cleanup of an owned local process tree.

## Decision

### Completed retention

The retained-completed registry has an exact minimum of 1 record, a default of 1,000 records, and a hard maximum of 1,000
records. The consumer MAY select a lower construction value within that range. Active invocations do not consume this capacity
and are never evicted. Eviction remains deterministic FIFO as defined by the AgentManager v1 specification. Handles remain the
primary completed-result path; durable result history remains consumer-owned.

### Admission, concurrency, and listener ownership

V1 defines no package-owned active-invocation capacity and no internal invocation-admission queue. The consumer owns admission
control, concurrency limits, scheduling, and overload policy before calling `start()`. Bounded active-recovery input and
bounded executable-probe concurrency are separate safeguards and are not active-invocation admission limits.

Lifecycle listeners execute synchronously through the package subscription boundary. The package creates no asynchronous
listener queue, listener-worker pool, or numeric fanout limit. The consumer owns listener execution cost, downstream buffering,
batching, parallel fanout, and backpressure. A slow listener may add consumer-side latency, but listener failure remains isolated
from invocation outcome. This decision adds no listener registration-order, fairness, parallelism, or maximum-latency guarantee.

### Workspace/CWD authorization

`workspace.directory` is consumer-authorized input. At preflight it MUST be bounded, normalized, absolute, exist, and identify
a directory. The manager uses that directory as the invocation working directory. Invalid input fails with
`revo.agent.workspace_invalid` before output-leaf claim or invocation spawn.

V1 performs no package-owned workspace `realpath` certification, symlink prohibition or certification, workspace/output
containment proof, ownership check, or provenance check. Consumer authorization is the trust decision; pathname validation does
not establish hostile-rebinding safety. No containment relationship between `workspace.directory` and `output.directory` is
required or implied. This workspace policy is separate from ADR-0010's output stable-ancestor warranty.

### Advisory provider cancellation and authoritative local cleanup

A definition whose `capabilities.cancellation` is `true` permits its selected adapter to expose one provider-neutral graceful-
cancellation dispatch. For caller cancellation, deadline expiry, and shutdown cancellation, the runtime dispatches that hook
best-effort without awaiting provider acknowledgement or completion. A `false` capability, an unavailable hook, a dispatch
failure, or a provider that does not complete after dispatch MUST NOT delay, suppress, or replace local cleanup.

The runtime starts the consumer-backed `cancelling` active-state save best-effort, but does not await that save, its timeout, or
its eventual quiescence before local termination. Existing bounded diagnostics and reconciliation rules continue to govern the
maybe-persisted active row; persistence uncertainty never delays local cleanup.

Authoritative local cleanup sends `SIGTERM` to the live-authorized invocation process group, waits no more than 2,000 ms for
group termination, sends group `SIGKILL` if the group remains live, and requires confirmed group absence and leader reap before
cleanup is successful. Caller cancellation, wall/idle deadline expiry, manager shutdown, natural leader exit with possible
descendants, and identity-authorized recovery cleanup share this escalation and confirmation contract. Natural exit and recovery
do not imply provider graceful-cancellation dispatch. Persisted PID/PGID values alone remain insufficient signal authority.

Failure to confirm cleanup follows the existing nonterminal or failed-closed contract and MUST NOT synthesize successful
completion or successful shutdown.

### Platform rollout

The first implementation and native-conformance target is Linux on a local `ext4` filesystem. This is a target cell, not a
shipped support claim. macOS is a later, separately evidenced implementation and validation slice; Linux evidence MUST NOT be
generalized to macOS, and no macOS filesystem cell is named before native evidence selects it. Windows is outside the MVP. Until
a separately approved Windows process/filesystem design and native evidence exist, invocation preflight follows
`revo.agent.platform_unsupported` before output-leaf claim or process spawn.

Provider versions, provider-specific cancellation wires, and provider compatibility remain unresolved until provider conformance
records them.

## Consequences

- Consumer concurrency and listener-fanout policy cannot be inferred from package bounds.
- Provider graceful cancellation is advisory; local process-group cleanup is authoritative.
- The 2,000 ms interval is target behavior and does not describe current private implementation behavior.
- Linux/local-`ext4` first is an implementation/evidence sequence, not current package availability.
- ADR-0010's output stable-ancestor warranty remains unchanged and separate from workspace authorization.

## Rejected alternatives

- **Wait for active-state persistence or provider cancellation before local termination:** turns an unavailable consumer sink or
  provider into an unbounded process-resource hold.
- **Introduce package-owned admission or listener queues:** makes consumer scheduling and downstream backpressure package
  responsibilities.
- **Treat workspace normalization as authority or topology proof:** cannot establish realpath, symlink, ownership, provenance,
  containment, or hostile-rebinding safety.
- **Claim Linux evidence as macOS or Windows compatibility:** substitutes an untested cell for native conformance evidence.
