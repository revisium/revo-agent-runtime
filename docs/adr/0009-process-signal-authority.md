# ADR-0009: Separate active-row correlation from authority to signal

- Status: Accepted
- Date: 2026-07-29
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md),
  [ADR-0006](./0006-consumer-backed-active-invocation-recovery.md), and
  [ADR-0008](./0008-real-mechanics-supervision-boundary.md)

## Context

The consumer can retain an active row longer than the manager lives. PID and PGID can be reused,
and an invocation ID, pin, `startedAt`, and any future epoch describe the row's correlation to an
attempt but do not grant the package authority to affect a process. That authority cannot be
derived from consumer-storage data.

## Decision

All persisted `pid`, `processGroupId`, `invocationId`, `pin`, `startedAt`, and any future epoch
are correlation data only. Neither separately nor together may they authorize `SIGTERM`,
`SIGKILL`, reap, or a claim about descendants.

The package has exactly two sources of authority to signal:

1. a private live process capability created and held by this manager instance; or
2. during recovery, a fresh observation from a package-owned platform inspector whose canonical
   fingerprint exactly matches the saved fingerprint.

In the second case, the package first observes the leader and recomputes the fingerprint. Only
an exact match authorizes signalling the corresponding group. In every other case, the persisted
row grants no authority to affect the operating system.

Option A is selected: persisted `running` is the acceptance boundary. Before that boundary, the
lifecycle is private; a rejected `start()` creates no public lifecycle record. This separates an
unaccepted setup from an accepted invocation, which follows the ordinary public lifecycle.

A claimed output leaf from rejected setup remains consumer-owned evidence. This ADR does not add
Windows, a provider adapter, a public API/export, result publication, or consumer storage.

The normative recovery, pre-acceptance, sink, typed-fault, and shutdown outcomes are defined by
[AgentManager v1 specification](../specs/agent-manager-v1.spec.md#signal-authority-and-context-specific-outcomes).
The required real-process-harness proof is defined by the
[roadmap](../roadmap.md#real-process-filesystem-security-cancellation-and-shutdown-conformance).

## Consequences

- Recovery does not turn consumer storage into a capability for operating-system control.
- Consumer storage remains a correlation and workflow boundary, not a way to control processes;
  the consumer externally resolves cases unavailable to the package.
- The Option A boundary prevents a briefly existing, unaccepted setup from becoming an accepted
  invocation, result, or retention record.
- The exact active-state quiescence and reconciliation rules remain in the specification, and
  their provider-neutral real-process proof remains in the roadmap; this ADR does not duplicate
  those lifecycle mechanics.
- The documentation refines a draft target; implementation, platform evidence, and public export
  remain absent.

## Rejected alternatives

- **Signal from persisted PID/PGID:** can affect a reused process.
- **`invocationId`, pin, or epoch as a process fencing token:** these are consumer-workflow
  correlation, not an observable package capability.
- **Claim descendant cleanup without a live leader:** a persisted PGID does not prove that
  descendants belong to the invocation.
- **The former post-acceptance terminal-result path:** makes an unready pre-`running` process a
  public invocation even though the initial active-state record was not confirmed.
