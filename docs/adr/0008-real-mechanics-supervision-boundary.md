# ADR-0008: Refine the real-mechanics supervision boundary

- Status: Accepted
- Date: 2026-07-28
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md),
  [ADR-0003](./0003-invocation-output-recording.md), and
  [ADR-0006](./0006-consumer-backed-active-invocation-recovery.md)

## Context

The target `AgentManager` needs one precise boundary for real process supervision without becoming a consumer workflow
engine. The earlier ADRs establish a sealed process-local manager, exact consumer-owned output leaves, and consumer-backed
active-process recovery. They do not decide how a multi-invocation manager keeps executable evidence current, separates
technical evidence from public lifecycle notifications, or assigns the remaining mechanics to implementation stages.

## Decision

One process-local manager MAY supervise multiple accepted consumer invocations. Each accepted invocation owns exactly one
root process tree; the manager does not infer a consumer run, step, attempt, queue, workspace allocation, or retry model
from that tree. `ProcessManager` and `ManagedProcess` are private TypeScript/Node implementation mechanics, not public
contracts or package entrypoints.

Immediately before each invocation is allowed to claim its output leaf and spawn, the runtime freshly resolves the launch
command and proves the required `launch.versionProbe` result as strict SemVer. It launches the resolved absolute executable,
not an earlier probe result or the unresolved command string. Public launch evidence is limited to that resolved path and
reported version. A platform or executable-version failure is fail-closed before output-leaf claim and invocation spawn.
ADR-0006's post-spawn fingerprint remains separate: it proves local process identity for recovery and PID-reuse safety; it
does not substitute for fresh launch eligibility.

Public events are lifecycle notifications only. They carry no stdout/stderr, diagnostic, artifact, or full-result payload.
`invocation.finished` means that the corresponding terminal result is available through the result API; it is not a second
result transport. The runtime owns bounded, redacted technical evidence in the result and the exact invocation files
already assigned by ADR-0003. The consumer owns scheduling, durable state, path construction, retention, workspace
allocation, diffs, retries, workflow transitions, and user-facing projections.

This explicitly refines ADR-0002's earlier consequence wording that places `invocation.finished` alongside result-returning
paths: terminal `invocation.finished` is an availability notification only and carries no completed-result payload. The typed
result remains available through the handle and manager result APIs. It also clarifies ADR-0003: bounded redacted technical
evidence in its invocation files and result record is not an event payload.

For an invocation that has crossed the synchronous output-leaf/active-registration acceptance transition, this ADR also
refines ADR-0006's earlier pre-handle rejection wording: a spawn, initial process-identity, or initial active-state-save
failure follows cleanup and the one typed terminal result path. Only a failure before that acceptance transition rejects
`start()` without a handle.

Cancellation, deadlines, shutdown, output finalization, terminal arbitration, exact byte/file/completed retention, and
redaction are normative specification concerns. Their algorithms and limits belong in the draft specification, not this ADR.
Likewise, active-run capacity, listener fanout, filesystem trust policy, supported platform/filesystem cells, Windows and
CI behavior, and provider conformance require their own approved evidence before implementation claims them.

## Consequences

- The manager may have many process trees, but each invocation has one root tree and one terminal result.
- Consumers subscribe for lifecycle progression and obtain typed results through handle and manager result APIs.
- Fresh launch evidence and post-spawn recovery identity have different owners and cannot be conflated.
- Existing accepted ADRs remain unchanged; this ADR narrows their target mechanics without moving durable workflow or file
  hierarchy ownership into the package.
- No code, provider conformance, supported platform cell, CI evidence, or root package export is implemented by this ADR.

## Rejected alternatives

- **Expose a public `ProcessManager` or `ManagedProcess`:** leaks Node/process mechanics and creates a second consumer
  execution contract.
- **Use a cached probe or ADR-0006 fingerprint as launch proof:** either can be stale and neither proves the current launch
  executable/version immediately before use.
- **Stream output, diagnostics, or results through events:** duplicates bounded file/result contracts and makes event
  fanout a public backpressure and retention surface.
- **Make the package own consumer scheduling, retries, directories, or retention:** crosses the ADR-0002/0003 consumer
  boundary.
