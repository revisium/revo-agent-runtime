# ADR-0006: Reconcile consumer-backed active invocation state

- Status: Accepted
- Date: 2026-07-19
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md)

## Context

ADR-0002 keeps workflow durability, retry, and restart policy in the consumer. A restarted consumer still needs the runtime
to safely clean up local agent processes that may have outlived the previous manager process. Persisting terminal results or
workflow state in the runtime would duplicate the existing result API, output files, and consumer database. Conversely,
killing a persisted PID or process-group id without verifying process identity could signal an unrelated process after PID
reuse.

Native Codex, native Claude, and ACP over stdio lose their controlling pipes when the manager process exits. V1 cannot
reattach to those invocations even when an operating-system process remains alive. Reconnectable ACP over a durable socket
or daemon transport is a separate future capability.

## Decision

The consumer owns the database or repository of active invocation rows. It loads the rows selected for one local manager,
passes them once to asynchronous `AgentManager.initialize()`, and owns DBOS, retries, distributed races, locks, leases, and
every result or history record. The runtime receives only an `ActiveInvocationStateSink` with `save` and `remove`; it has no
database read API and no knowledge of Prisma, DBOS, hosts, Kubernetes, claims, or leases.

An active row contains only an invocation id, the exact agent execution pin, `running | cancelling`, and local process
identity: PID, POSIX process-group id, an opaque package-generated fingerprint, and an application timestamp
for observability. It contains no result, terminal status, prompt, credential, environment, or workflow metadata. The
consumer already owns the output-directory coordinate, so v1 does not duplicate it in this recovery row.

The fingerprint is `sha256:<lowercase hexadecimal>` over a versioned canonical package-owned process-identity record. That
record uses OS-reported immutable identity available to the platform adapter: at minimum process creation identity/time,
resolved executable identity/path, PID and process-group identity, plus a local boot or session discriminator
when the platform supplies one. The runtime never hashes argv, environment, prompts, credentials, or caller-controlled
mutable data. `startedAt` is observability data and is not a fingerprint input. Capture and recovery inspection use one
platform process inspector; recovery recomputes and exactly compares the fingerprint.

Active persistence and recovery v1 are local POSIX features for `darwin` and `linux`. Each invocation starts in its own
process group. The runtime bounds post-spawn inspection, fingerprinting, and `save`, and saves the active row before returning
an accepted handle. Invocation wall-clock timing starts at successful spawn, not logical acceptance or handle return. Capture,
save, or timeout failure kills and reaps the just-spawned process group before start rejects.

Cancellation attempts to save `cancelling` before sending a signal, but a bounded sink failure is diagnostic and does not
prevent kill/reap through the live in-memory child handle. Termination sends `SIGTERM` to the group, waits for a bounded
interval, escalates to `SIGKILL`, and confirms termination/reap. After leader exit, the manager performs the same sweep for
remaining descendants before removing the row or finalizing. Unconfirmed group cleanup preserves the row and blocks false
terminal completion. Cancellation before spawn requires neither a sink call nor a process signal; cancellation after spawn
but before the initial snapshot uses the live child handle and writes no snapshot.

Initialization is one-shot and concurrency-safe. It validates the complete consumer-supplied list before reconciliation.
Duplicate or structurally malformed rows fail initialization without signaling or removing any process. Pin and process
checks then run independently for each structurally valid row within bounded operation and total initialization deadlines:

- a missing process produces `remove`;
- an unknown or digest-mismatched exact pin is preserved without inspection or signalling and reported as a row failure;
- a live leader with a verified identity match is terminated and reaped before `remove`;
- a live PID/fingerprint mismatch is never signalled or removed and is reported as an identity conflict;
- inspection uncertainty, termination uncertainty, or a sink failure preserves the row and fails initialization closed.

The snapshot list is trusted consumer selection for this local manager. The consumer owns its integrity and provenance; the
fingerprint check provides anti-PID-reuse identity protection, not process ownership proof. A mismatch may also reflect
executable drift, so v1 cannot safely prune it. The consumer retains exact definitions for selected rows or remediates
preserved pin/identity conflicts. Valid independent rows still reconcile before initialization reports the aggregate failure.

Native Codex, native Claude, and ACP-over-stdio rows all use this cleanup policy; v1 does not reattach. If the recorded leader
has disappeared while descendants remain, the runtime cannot prove that a persisted process-group id still belongs to this
invocation. It removes the stale row and does not claim that descendants were safely cleaned up.

After a normally observed leader exits and its full process group is confirmed gone, the runtime removes its active row
before result parsing and output finalization. A bounded removal failure leaves only a stale consumer row; it is surfaced as
a diagnostic and does not change the invocation's existing terminal result. Active rows never store completed results and
there is no `finished_pending_ack` state.

Initialization and every active-state operation have explicit manager-level timeouts and abortable sink contexts. Shutdown
before initialization closes an empty manager. Shutdown during initialization stops new reconciliation work, aborts/waits
only to the initialization deadline, and still requires confirmation for any recovery process already signalled. It cannot
wait indefinitely.

## Consequences

- A consumer can restart one local manager and ask the package to reconcile only the rows it selected.
- The package supplies safe local spawn, identity, termination, and cleanup mechanics without becoming a durable workflow
  store.
- Construction remains synchronous, but process-creating and observation operations are unavailable until the one shared
  initialization settles successfully.
- A failed initialization is permanently failed-closed; retry requires a new manager and a freshly loaded row set.
- Unsupported platforms may initialize only an empty recovery set; their existing non-recovery invocation behavior remains
  available without a Windows fingerprint or process-tree recovery promise.
- A small spawn-to-inspection failure window is closed by mandatory kill and reap before start rejection, but a machine or
  runtime crash before the first successful `save` can still leave an untracked process. Eliminating that crash window would
  require an external supervisor and is deferred.

## Rejected alternatives

- **Package-owned database or rich store:** duplicates consumer durability and introduces persistence-policy coupling.
- **Claims, leases, or fencing in AgentManager:** mixes distributed orchestration with local process supervision.
- **Persist terminal results in active rows:** duplicates the result API and leaves completed history in an operational
  ledger.
- **Kill by persisted PID or process-group id alone:** can terminate unrelated processes after identity reuse.
- **Treat every ACP process as reconnectable:** stdio transport cannot be resumed after the controlling process exits.
