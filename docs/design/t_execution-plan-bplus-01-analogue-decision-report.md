# Execution handoff architecture reset decision report

- Status: Accepted
- Date: 2026-08-19
- Repository: `@revisium/revo-agent-runtime`
- Repository HEAD inspected: `cbb9b158bb06d3c474e0286d9ddffec03f4d2efd`
- Analogue evidence SHA-256: `ff90dde8160ebbb257e2dd4277d703a8d9a8168bcc972d3b76b14474fdb29783`
- Superseded working draft SHA-256: `4bf13555e264ba66dadd12dc9e182762992c4867dc2ae617fab00304cc724a4a`
- Decision: [ADR-0013](../adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md)
- Canonical contract: [B+ execution handoff specification](../specs/execution-handoff.spec.md)

## Decision

Select **B+**: seal every resource-independent invocation decision before output mutation, preregister output-claim ownership in shutdown drainage, bind only attested claimed resources afterward, and transfer the final spawn material through a private one-use carrier to one duplex terminal coordinator.

This reset separates the stable decision and behavioral contract from implementation sequencing. The accompanying normative specification contains no PR ledger or TDD script.

## Informative constraint summary

This section summarizes requirements owned by the canonical execution-handoff specification. It does not establish an
independent normative contract.

- The definition set is package-owned, canonical, frozen, and read exactly once for an invocation.
- Request, schema, permission, environment, workspace, output-path, platform, and fresh executable proof failures that do not require output mutation occur before output claim.
- The package claims only an absent output leaf, never adopts or replaces evidence, and retains claimed rejected-start residue for the consumer.
- Output claim and shutdown ownership have no unregistered interval. A timed-out dispatched claim remains attached to one authentic retained guard until late settlement and quiescence are reconciled.
- Secrets are registered before spawn, and raw child bytes never reach a parser, file, result, fault, event, completed record, or callback.
- Process signalling requires private live authority. Persisted identity and the immutable public-safe process identity view are correlation evidence, not signalling capabilities.
- Process start is preregistered before native spawn. Spawn acceptance atomically captures private live authority, pauses process I/O, arms wall/idle and the one active-state setup deadline, and leaves every post-spawn rejection with confirmed cleanup or the authentic retained cleanup authority.
- The canonical specification places only immediate post-spawn identity inspection, fingerprint capture, and fulfillment of the initial `running` save inside one `activeStateOperationTimeoutMs` setup window. It places sole-coordinator registration and coordinator/I/O activation after acceptance and outside that window, without extending, resetting, or consuming it. Cancellation, wall/idle timeout, shutdown, identity failure, and save failure all clean through the same live authority.
- Native stdout/stderr remain unread and unpumped until the sole coordinator is drain-registered. One branded activation transfers authority and timers before starting callbacks; double activation is a quarantined internal invariant and pre-activation failure drains without callbacks.
- The output port alone constructs redaction front ends and bounded raw destinations. Output cleanup/publication authority exists and is registered before the first postclaim preparation mutation; preparation timeout, rejection, late settlement, disposal, quiescence, and shutdown drainage remain bound to that authority.
- Protocol redaction uses one authentic deferred destination binding: preparation creates no protocol session and buffers zero pre-bind bytes; finalization creates the authentic session, binds exactly once, and quarantines any construction, mismatch, or double-bind defect.
- The mechanical postclaim finalizer has only one rejection, `internal_invariant_violation`; it maps to quarantined `revo.agent.internal` and never re-exposes a deterministic limit, environment, or secret caller failure.
- The process/result path has one terminal authority. Natural-exit descendant uncertainty is the exact nonterminal `process_cleanup_failed` primary/cause when no earlier primary won, retains evidence and cleanup authority, and continues only after late confirmed absence/reap.
- `result.json`, ADR-0003's failure-only result-extraction/parsing/validation `raw-final-response.txt`, and lifecycle NDJSON are distinct evidence responsibilities with non-replacing semantics.
- The canonical specification controls the full affected `AgentManagerLimits` surface and fixed runtime constants. It places the active-state operation timeout no higher than the initialization timeout, the idle timeout no higher than the wall-clock timeout, and preserves the lifecycle-event file's terminal reservation relation. Its ADR-0011 cleanup sequence waits no more than 2,000 ms after TERM and sends KILL only if the group remains live.

## Analogue evidence boundaries

### Hermes Agent

Hermes provides positive evidence for an immutable launch request followed by later resource binding and capability-bearing lifecycle registration. Its terminal stack is negative evidence for late generic interpretation: command rewriting, shell selection, environment setup, and some policy checks occur near execution, and some isolation/persistence failures degrade best-effort. Revo adopts phase separation, not Hermes' fallback or process-authority model.

### AionUi / AionCore

AionCore is the closest positive analogue for front-loading provider/session command assembly and keeping spawn thin. Its process object owns cleanup. It does not provide Revo's exclusive output leaf, active-state acceptance barrier, non-replacing terminal publication, retained claim guard, or secret lifetime guarantees. Revo adopts the front-loaded decision/thin-spawn split, not Aion's mutable command carrier.

### Cursor

Cursor's official material establishes environment provisioning, sandbox/permission binding, secret injection/redaction controls, and the possibility of nonzero exit without a terminal event. Its execution-preparation internals are proprietary. Cursor therefore supports only the broad resource-and-policy-before-execution and exit-independent-terminal-observation requirements; it cannot distinguish A, B, B+, or C.

## Options considered

### A — permanent preflight `PreparedExecution`

Rejected. Before claim it cannot authenticate created scratch files, exclusive evidence destinations, or live publication authority. If it exposes argv/environment permanently, it also extends sensitive-reference lifetime.

### B — build everything after claim

Rejected. Moving defaults, schema validation, permission mapping, template interpretation, environment checks, or prospective bounds after mutation turns deterministic caller defects into quarantined output residue.

### B+ — sealed intent, preregistered claim, attested resources, one-use consume

Selected. It preserves deterministic preclaim rejection, closes the claim/shutdown race, makes filesystem authority explicit, supports direct native and later ACP duplex delivery through one provider-neutral contract, and prevents the spawn layer from becoming a second composition root.

### C — lazy generic adapter interpretation

Rejected. It permits registry or definition rereads, late provider-policy selection, hidden shell/argv transformation, unclear parser provenance, and untestable preclaim/postclaim failure ordering. Hermes' generic terminal stack illustrates these risks; AionCore's thin spawn illustrates the safer boundary.

## Accepted consequences

- More internal capabilities exist because claim, publication, process, cleanup, and active-state authority are genuinely different lifetimes.
- A timed-out claim or uncertain reap can fail the manager closed and extend the consumer's stable-ancestor obligation.
- Preparation owns a manager-only bounded operation window; its identical pre-established publication authority owns every partial mutation and late disposal.
- Deferred protocol binding adds one private one-use capability but no buffer or runtime branch after finalization.
- Paused I/O may apply bounded kernel-pipe backpressure during identity inspection; the actual-spawn wall/idle timers and single active-state setup deadline bound that interval without a user-space buffer.
- The approved sequencing places the first provider-neutral harness before Native Codex conformance; Claude and ACP remain later adapters.
- JavaScript strings cannot be physically erased. The contract promises prompt reference release and best-effort zero-fill only for owned mutable byte buffers.
- Terminal publication is not identical to process-local completion: a live manager still commits one typed result when late evidence recording fails, while the audit record may be incomplete.

## Canonical disposition

B+ and [ADR-0013](../adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md) are approved, and the exact package-private mechanics are controlled by the [canonical execution-handoff specification](../specs/execution-handoff.spec.md). Root export, npm publication, supported platform/filesystem cells, Native Codex conformance, and later-provider coverage remain separate gates.

## Architecture status

Canonical architecture approval is complete. Product implementation remains unshipped; later compatibility or support claims depend on conformance with the canonical execution-handoff specification.
