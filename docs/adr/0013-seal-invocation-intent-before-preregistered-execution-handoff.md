# ADR-0013: Seal invocation intent before preregistered capability-bound execution handoff

- Status: Accepted
- Date: 2026-08-19
- Refines: [ADR-0008](./0008-real-mechanics-supervision-boundary.md),
  [ADR-0009](./0009-process-signal-authority.md),
  [ADR-0010](./0010-consumer-warranted-stable-output-ancestors.md), and
  [ADR-0011](./0011-consumer-governed-local-supervision.md)
- Related: [ADR-0003](./0003-invocation-output-recording.md)
- Specification: [B+ execution handoff](../specs/execution-handoff.spec.md)

## Context

An invocation must combine immutable definition decisions with resources that can be authenticated only after the output leaf
exists. Treating one early carrier as final cannot prove those resources. Deferring generic interpretation until after claim
instead turns deterministic caller and policy defects into mutated output residue.

The current target also needs uninterrupted shutdown ownership across output claim, resource preparation, native spawn,
identity persistence, process I/O, cleanup, and terminal publication. Visible identifiers and structurally similar objects
cannot safely grant that authority, and eager output consumption can expose bytes before the terminal owner is installed.

## Decision

Adopt the B+ handoff. The package seals every resource-independent invocation decision before output mutation. It preregisters
the owner and bounded settlement of output claim before dispatch, then binds only attested claimed resources into a private
one-use execution carrier.

Process start is likewise preregistered before native spawn. Spawn acceptance creates private live authority while process I/O
remains paused. Identity capture and the initial active-state save complete before acceptance; one duplex coordinator then
receives authority and activates I/O exactly once. Output preparation establishes separate publication and cleanup authority
before its first mutation, and that authority remains registered through terminal filesystem quiescence.

Authority-bearing carriers are authentic capabilities rather than structural data. Raw process bytes cross only independent
redaction fronts, terminal candidates compete through one coordinator, and uncertain claim or cleanup retains the authentic
owner and fails closed. Migration replaces the old private seams atomically; no compatibility overload or second execution,
I/O, completion, or publication path remains active.

Private live authority governs normal in-memory signalling only. Recovery cleanup remains governed by ADR-0009: a fresh
package observation must exactly match the saved fingerprint before it authorizes signalling, while persisted identity remains
correlation data.

## Alternatives Considered

- Keep a permanent preflight carrier: rejected because it cannot attest postclaim resources or live publication authority and
  unnecessarily extends sensitive-reference lifetime.
- Build the complete execution after claim: rejected because deterministic input, policy, environment, and bound failures would
  occur only after filesystem mutation.
- Let a generic adapter interpret lazily: rejected because it permits late selection, registry rereads, hidden command changes,
  unclear parser provenance, and competing ownership.

## Consequences

- Every mutation and live process has a preregistered bounded owner, eliminating the unregistered claim and spawn intervals.
- Deterministic failures stay preclaim; postclaim invariant defects quarantine the claimed output rather than masquerading as
  caller errors.
- More private capabilities and reconciliation states are required, and an uncertain claim or reap can keep the manager failed
  closed and extend consumer obligations.
- Paused I/O may apply bounded operating-system pipe backpressure during identity and active-state setup.
- ADR-0003 remains unchanged. This decision does not alter its output responsibility or authorize a public API, package export,
  package publication, provider compatibility, or supported-platform claim.
