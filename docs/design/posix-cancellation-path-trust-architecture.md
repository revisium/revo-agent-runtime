# POSIX Cancellation and Path-Trust Architecture

Status: `architecture_complete`
Scope: provider-neutral policy boundary and next-stage architecture for POSIX cancellation, deadlines, shutdown, and invocation-output path trust
Baseline: `origin/master` / `c0c64139986305b9d7072be19bbc9fe5f0a7843c`
Input: approved `docs/design/posix-cancellation-path-trust-analysis.md`

> Historical architecture artifact: current-state statements below refer only to the pinned baseline. The implementation
> later completed the provider-neutral root API under ADR-0012 and the B+ handoff under ADR-0013. Provider internals stay
> private; supported-cell declaration and active-process reconnection remain separate delivery decisions.

This is an architecture-stage artifact. It records a boundary, invariants, integration contracts, decision points, and a developer-stage plan. It does not amend an ADR or specification, create a public API, select a consumer threat model, claim platform/filesystem support, or describe unimplemented behavior as shipped.

## Compact decision block

**Context:** The consumer constructs workspace and output paths. The package owns one physical invocation, its live process authority, bounded output mechanics within one exact consumer-supplied directory, cancellation/deadline arbitration, reaping, and process-local shutdown. At the pinned baseline, source proved private deterministic lifecycle behavior and a candidate-host Linux process slice, but not Darwin process supervision, a real output filesystem implementation, or a public `AgentManager`.

**Problem:** A normalized absolute pathname identifies a name, not a trusted directory object. The accepted target requires exclusive leaf claim and non-replacing result publication while deliberately deferring ancestor symlink, provenance, mount, network-filesystem, and TOCTOU policy. Cancellation and shutdown additionally constrain cleanup: process-group reap must precede file finalization, and the package may remove only its own scratch/temp objects, never consumer evidence.

**Question:** Where should the trust decision live, how should package mechanics consume it without provider or platform leakage, and what evidence is required before a support claim?

**Options:**

1. Consumer-certified stable ancestors with the existing pathname mechanics and an explicit residual-risk statement.
2. Package pathname preflight that walks/rechecks ancestors but does not hold a directory capability.
3. A trusted-root/directory-capability design with descriptor-relative descendant operations on supported POSIX/filesystem cells.

**Recommendation:** Fix the policy boundary now, but do not choose the policy value for the user. The consumer owns and explicitly warrants the selected ancestor threat model; provider-neutral application/runtime code admits that warranty and selects only an approved package enforcement profile; platform/filesystem code returns native evidence for that profile. Do not treat Option 2 as hostile-ancestor protection because it cannot bind later pathname operations to the inspected object. If the user excludes hostile ancestor mutation, Option 1 is the bounded v1 route. If hostile mutation is in scope, stop implementation and investigate Option 3 and its native feasibility before changing contracts. No provider adapter may choose, weaken, or infer the policy.

## 1. Status and source-of-truth interpretation

The following are shipped facts at the baseline:

- at the pinned baseline, the root package export was intentionally empty;
- private registry, executable-probe, deterministic lifecycle/result, and process-supervision slices exist and are tested;
- `InvocationLifecycle` has caller/deadline cancellation arbitration over abstract execution, clock, and output ports;
- `LiveOwnedProcess` holds a private idempotent `terminateAndReap()` capability;
- `NodePosixProcessSupervisionPort` is currently Linux-only: `start()` rejects every non-`linux` host, and its default identity inspector is `inspectLinuxProcess`;
- the implementation and integration lane have candidate-host Linux process evidence only, not a supported-platform guarantee.

The following remain target or deferred:

- at the pinned baseline, the public `AgentManager` and its root export;
- a real invocation-files implementation for leaf claim, scratch, logs, events, and `result.json`;
- complete active-state, cancellation, deadline, and shutdown composition;
- ancestor trust/provenance policy;
- Darwin process supervision, which remains an ADR-0006 target without current implementation or native evidence;
- supported platform/filesystem cells and provider conformance.

Accepted ADRs and the draft AgentManager specification constrain future implementation, but do not make these targets shipped. Any developer stage must preserve that distinction in comments, docs, tests, declarations, and package exports.

## 2. Architectural boundary selected here

### 2.1 Boundary, not policy value

The selected provider/platform-neutral boundary is a three-part contract:

1. **Consumer warranty:** the consumer states the environment property on which safe interpretation of its path depends.
2. **Package enforcement:** the package applies only mechanics that it can deterministically enforce for the selected, approved profile and fails closed when those mechanics cannot be completed.
3. **Native evidence:** a platform/filesystem adapter reports what primitive and filesystem behavior was actually observed; tests delimit the cells for which that evidence is sufficient.

This separation is the architectural decision. The choice between a stable-ancestor warranty and a hostile-ancestor-resistant trust anchor remains a human product/security decision. The architecture must not encode that choice through a default, provider identity, platform check, or undocumented inference.

### 2.2 Why this boundary is provider-neutral

Path trust is independent of Codex, Claude, ACP, or any future protocol. Provider adapters receive already-admitted invocation-local facilities; they neither receive the consumer trust statement nor select filesystem behavior. The same cancellation, deadline, shutdown, process, and output contracts apply to every provider strategy.

The application composition layer owns policy admission because it is the only layer allowed to combine consumer input, immutable package policy, runtime execution ports, and concrete platform adapters. Portable runtime contracts describe required effects and evidence without importing Node types. Platform code implements native operations. Provider strategies remain below neither policy nor support decisions.

### 2.3 Why this boundary is platform-neutral

The portable boundary speaks in domain terms: exact leaf, non-adoption, trusted-ancestor warranty, cleanup authority, exclusive publication, operation completion, and evidence. It does not expose file descriptors, `openat`, `/proc`, Node `ChildProcess`, signals, errno values, or mount APIs.

A POSIX adapter may use pathname primitives for a stable-ancestor profile or descriptor-relative primitives for a future hostile-ancestor profile. Windows, Darwin, Linux, local filesystems, network filesystems, and mounts are support cells behind this boundary, not branches in provider or domain code.

### 2.4 Admissible profiles

Architecture recognizes two possible terminal profiles, but approves neither as the user's product policy:

- **Stable-ancestor profile:** the consumer warrants that every path ancestor used by package operations is trusted and remains stable from preflight through terminal filesystem quiescence. The package still validates bounded normalized absolute paths, claims the exact absent leaf, never adopts evidence, and performs non-replacing child operations. This profile explicitly does not protect against hostile ancestor rebinding.
- **Capability-rooted profile:** the consumer identifies or supplies an approved existing trust root; the package binds all descendant claim, publication, and cleanup operations to stable native directory capabilities. This profile is only a design candidate until native feasibility, API shape, and support cells are approved.

A pathname walk/recheck without a held capability may be useful as misconfiguration detection, but it is not a third terminal trust profile and must never be represented as symlink/TOCTOU security.

## 3. Invariants

### 3.1 Ownership and path invariants

1. The consumer owns path construction, provenance, hierarchy, workspace allocation, durable indexing, retention, recovery, and recursive residue deletion.
2. The package treats the supplied output directory as one opaque invocation leaf. It does not derive a run/step/attempt hierarchy or require workspace containment.
3. Workspace and output path inputs remain bounded normalized absolute paths. Absolute does not mean trusted.
4. The exact final leaf must not exist. The package claims it atomically and non-recursively; any existing file, directory, or symlink is a conflict.
5. The package never adopts, overwrites, rotates, suffixes, replaces, or deletes an existing output leaf.
6. Concurrent claims for one leaf have exactly one winner.
7. Once claimed, the leaf is consumer-owned evidence, including after rejected pre-acceptance setup. Retry uses a fresh path.
8. Package cleanup authority is limited to package-created scratch and unpublished temporary objects whose identity is still established by the selected trust profile.
9. The package never recursively removes the output leaf or an ancestor during cancellation, deadline expiry, shutdown, or recovery.
10. Consumer residue deletion is outside package safety claims and requires the consumer's own provenance checks.

### 3.2 Process authority and lifecycle invariants

1. Every accepted invocation owns exactly one root process tree and one terminal result.
2. Persisted PID, PGID, invocation id, pin, timestamp, or epoch is correlation data, never signal authority.
3. Signal authority comes only from a private live process capability held by the current manager or a fresh package-owned observation whose canonical fingerprint exactly matches recovery evidence.
4. Cancellation, deadline expiry, and shutdown share the same owned-process termination/reap mechanism; they are causes, not independent execution paths.
5. `running` persistence is the public acceptance boundary. Pre-acceptance setup remains private.
6. Cancellation requested before live-process acquisition is latched and dispatched only if a private live capability is acquired.
7. The first terminal cause wins according to one explicit arbitration state machine. Repeated cancellation and shutdown calls share settlement rather than produce additional effects.
8. A leader exit does not prove descendant cleanup. Group absence and leader close/reap must be confirmed before active-row removal or terminal file finalization.
9. Unconfirmed reap leaves an accepted invocation active and nonterminal; shutdown fails closed while cleanup remains unconfirmed.
10. Shutdown stops acceptance, drains accepted and private pre-acceptance work, confirms owned probe/invocation cleanup, completes permitted finalization, and only then clears listeners.
11. A shutdown failure permanently closes that supervision domain. The consumer owns host escalation and must not create a replacement there until cleanup is externally resolved.

### 3.3 Output and result invariants

1. Reserved names remain `.scratch`, `events.ndjson`, `stdout.log`, `stderr.log`, failure-only `raw-final-response.txt`, and exclusive `result.json`.
2. Bounds and redaction apply before subscriber delivery and every file write.
3. `.scratch` is owner-only, never follows or adopts a conflicting symlink, and is cleaned only after process reap.
4. `result.json` publication is same-directory and non-replacing: exclusive temporary object, write and flush, exclusive publication to an absent result name, directory flush where supported, then temp cleanup.
5. Unsupported required publication semantics fail closed as output failure; they do not fall back to replacing rename.
6. No filesystem cleanup may run after the selected path/object authority is lost. Loss of authority is a typed failure or shutdown blocker, not permission to retry by name.
7. Late recording failure cannot strand process-local completion. One typed in-memory terminal result remains available even if `result.json` or the terminal NDJSON line is absent.
8. A terminal lifecycle event is an availability notification, not a result, output, diagnostic, or file transport.
9. Rejected pre-acceptance setup publishes no result, completed record, retention entry, or public lifecycle event.

## 4. Ownership matrix

| Concern                          | Consumer                             | Package application/runtime                        | Platform/filesystem or process adapter               | Provider adapter                                |
| -------------------------------- | ------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| Path construction and provenance | Owns                                 | Validates declared contract only                   | Does not infer                                       | No role                                         |
| Ancestor threat-model choice     | Owns and explicitly warrants         | Admits only an approved profile; no silent default | Reports enforceability/evidence                      | No role                                         |
| Output leaf claim                | Supplies exact leaf                  | Orders claim with pre-acceptance registration      | Performs exclusive native operation                  | No role                                         |
| Reserved child files             | Indexes/retains evidence             | Owns names, bounds, redaction, ordering            | Performs native operations                           | Emits bounded protocol data only                |
| Process signal authority         | Cannot grant through storage         | Retains private capability and arbitrates causes   | Signals/reaps from live or freshly matched authority | Requests no direct signal                       |
| Cancellation/deadline            | May request/configure                | Owns idempotence, cause, state, result             | Performs cleanup operation                           | Cooperates through one execution contract       |
| Shutdown                         | Calls and handles failure/escalation | Owns shared drain settlement                       | Confirms native quiescence                           | No independent shutdown path                    |
| Support claim                    | Chooses required deployment cells    | Publishes only approved cells                      | Produces cell-specific evidence                      | Produces separate protocol conformance evidence |

## 5. Consumer warranty, package enforcement, and native evidence

### 5.1 Consumer warranty

A consumer warranty is a prerequisite supplied by the host, not evidence generated by the package. For the bounded stable-ancestor route it must mean, at minimum:

- the consumer is authorized to designate the workspace and output path;
- all ancestors traversed by package pathname operations are trusted by the consumer;
- no actor outside that trust domain may replace, rename, or retarget those ancestors until all invocation filesystem operations quiesce;
- creation of missing ancestors, if allowed by the final human decision, is safe under the same trust domain;
- the target deployment filesystem provides the semantics required by the selected support cell;
- the consumer applies its own equivalent or stronger provenance rule before recursive residue deletion.

The package cannot verify these environmental facts merely by receiving an absolute string. Documentation must label them as assumptions/residual risk. A warranty must never be inferred from provider id, agent definition, path prefix, current user id, or successful `realpath`/`lstat` at one instant.

### 5.2 Package enforcement

Package enforcement consists only of observable guarantees under an admitted warranty/profile:

- bounded normalized absolute-path validation;
- immutable input snapshotting;
- exact non-existing leaf claim with no adoption;
- explicit mode/ownership settings for package-created private objects;
- reserved-name conflict rejection;
- ordered process reap before scratch cleanup and final publication;
- non-replacing `result.json` publication;
- idempotent, bounded cancellation and shutdown;
- typed fail-closed outcomes when required operations or evidence are unavailable;
- no cleanup outside package-owned objects;
- no support claim beyond verified cells.

A preflight path walk may supplement diagnostics but cannot strengthen the stable-ancestor warranty into hostile-ancestor resistance. If the chosen threat model requires resistance, enforcement must be redesigned around stable object capabilities rather than repeated pathname resolution.

### 5.3 Native evidence

Native evidence is implementation and test evidence that a concrete adapter met a requested enforcement profile for one support cell. It includes:

- which exclusive create/link/flush/unlink operations succeeded or failed;
- whether operations remained anchored to the intended directory object where the profile requires that property;
- actual group signal, group absence, and leader close/reap observations;
- abort/deadline quiescence of in-flight filesystem and active-state operations;
- hostile-race outcomes for symlink/rename substitution when that threat is claimed;
- filesystem behavior for hard links, directory flush, and unsupported operations;
- OS/filesystem identity sufficient to label the evidence cell.

Native evidence is not a consumer warranty and does not by itself create a public compatibility promise. Candidate-host evidence must be reported as such until the support matrix and CI coverage are approved.

## 6. Future integration contracts (no implementation in this stage)

Names below are responsibility labels, not approved public TypeScript declarations. The developer must use existing repository naming and may introduce a new internal interface only after Gate 1 and explicit implementation approval.

### 6.1 Output-session contract

The current output port is logical and too coarse for real object authority. A future invocation-output session must represent one successfully claimed leaf and own all subsequent reserved-child operations for that leaf.

Required effects:

- `claim` is part of the synchronous, non-re-entrant pre-acceptance transition with private drain registration;
- success returns a private session/capability, not merely a path string;
- repeated/final operations use that retained session authority;
- the session exposes ordered bounded recording, exclusive result commit, scratch cleanup, and quiescent close;
- cleanup methods can target only session-created scratch/temp objects;
- loss of native authority fails closed and never falls back to an unbound pathname;
- close is idempotent and reports whether all package-owned operations have quiesced;
- the interface carries provider-neutral outcomes/evidence and no Node descriptors.

Under a stable-ancestor profile, the concrete session may still be pathname-backed, explicitly relying on the consumer warranty. Under a future capability-rooted profile, the same runtime contract is implemented by descriptor-relative mechanics.

### 6.2 Owned-process contract

Extend behavior through the existing private `LiveOwnedProcess` concept rather than introducing public process handles.

Required effects:

- start returns immutable process identity, a completion observation, and one idempotent termination/reap capability;
- natural leader exit triggers descendant sweep before completion is eligible for terminal finalization;
- termination has bounded graceful and forceful phases;
- successful settlement confirms group absence and leader close/reap;
- failure preserves cleanup authority for a later shutdown retry;
- runtime receives normalized outcomes, not raw signals or child-process objects.

### 6.3 Cancellation contract

Cancellation is a cause submitted to one invocation state machine.

Required effects:

- caller cancellation is idempotent and shares one promise;
- pre-spawn cancellation performs no sink call or signal;
- post-spawn/pre-acceptance cancellation uses only the private live capability and follows Option A cleanup/release rules;
- accepted cancellation attempts the `cancelling` active-state save before first signal; save failure adds bounded diagnostics but does not revoke live signal authority;
- terminal state is committed only after confirmed process cleanup and allowed filesystem finalization;
- repeated or concurrent caller/deadline/shutdown requests do not signal or finalize twice.

### 6.4 Deadline contract

Deadlines are cancellation sources, not timer-owned terminal results.

Required effects:

- the package clock owns monotonic scheduling at the portable boundary;
- the wall-clock deadline starts at the normative lifecycle point defined by the target specification;
- timer expiry requests the same cancellation path with a `deadline` cause;
- disposal of the timer is idempotent and occurs before terminal publication;
- deadline/caller/natural-exit races use one terminal arbitration rule;
- a deadline does not allow the package to skip reap, active-state ordering, output cleanup, or result finalization;
- operation-specific deadlines for sinks/filesystem/process cleanup produce bounded failure and quiescence evidence rather than detached late mutation.

### 6.5 Shutdown contract

The manager owns one shared process-local shutdown settlement.

Required effects:

1. atomically stop new acceptance;
2. register and drain all already claimed/private-starting and accepted work;
3. request cancellation of accepted work through the ordinary state machine;
4. retry retained private cleanup capabilities for pre-acceptance failures;
5. wait for confirmed process and operation quiescence;
6. finish allowed scratch/temp cleanup, result publication, terminal events, and waiter settlement;
7. clear listeners only after successful drain;
8. resolve every caller from the same success settlement or reject every caller with the same shutdown failure;
9. remain permanently failed-closed after unconfirmed cleanup.

Shutdown never scans output directories, adopts crash residue, removes an invocation leaf, or makes a durable workflow decision.

### 6.6 Finalization ordering

For an accepted invocation, the required causal order is:

```text
terminal cause selected
  -> cancellation state save when applicable
  -> signal/live completion
  -> descendant sweep + confirmed group absence + leader reap
  -> active-row removal attempt
  -> derive provisional typed outcome
  -> scratch cleanup
  -> flush non-terminal evidence
  -> adjust provisional outcome for cleanup/evidence-recording failures
  -> one exclusive result.json attempt
  -> process-local completed record
  -> best-effort terminal NDJSON append
  -> exactly one invocation.finished notification
  -> result waiters settle
```

A failed active-row removal adds bounded evidence but does not mutate an already determined result. Unconfirmed process cleanup stops this sequence before active-row removal and file finalization. A late file failure follows the accepted in-memory completion rule rather than recursively retrying publication.

## 7. Non-goals

The next developer stage must not:

- select the consumer's hostile-ancestor threat model or support matrix;
- edit accepted ADRs, the draft public specification, repository contracts, or public exports unless a later separately approved contract stage explicitly authorizes it;
- expose `ProcessManager`, `ManagedProcess`, Node child processes, file descriptors, signals, errno, or provider SDK types;
- create provider-specific cancellation, deadline, output, or shutdown paths;
- add workflow scheduling, retry, replay, durable storage, claims, leases, host ids, or consumer database types;
- infer containment between workspace and output paths;
- scan, adopt, overwrite, suffix, rotate, or recursively delete consumer evidence;
- claim Windows, Darwin, Linux, local, overlay, mount, or network-filesystem support from generic unit tests or one candidate host;
- treat absolute paths, `realpath`, `lstat`, ownership bits, or one successful preflight as proof against hostile rebinding;
- publish a `/testing` entrypoint or public API before the separate public-surface gate;
- broaden the scope into provider conformance, environment/credential policy, result parsing, or durable recovery.

## 8. Human decisions and exact stop conditions

### 8.1 Decisions required before implementation scope is approved

The user/security owner must decide:

1. **Threat model:** Are output ancestors consumer-certified stable, or can a hostile actor create, rename, replace, or symlink them while an invocation is active or finalizing?
2. **Parent creation:** May the package create missing consumer-owned ancestors, or must the consumer supply an existing trusted parent and leave only final-leaf creation to the package?
3. **Symlinks/root:** Are ancestor symlinks forbidden, accepted under the stable-ancestor warranty, or permitted only beneath a specified trust root?
4. **API compatibility:** Must v1 remain pathname-only, or may a future contract require a trust-root/directory-capability concept?
5. **Support cells:** Which OS/filesystem combinations are intended for v1, including local Linux, Darwin, overlay/mounts, and network filesystems?
6. **Residue owner:** Which consumer component verifies provenance before recursively deleting rejected or crash-residue leaves?
7. **Gate scope:** Is the next developer stage limited to internal/private proof, with contracts and root export still unchanged? This document recommends yes.

Full Provider and platform conformance research remains a non-waivable prerequisite under `docs/roadmap.md:40-43`. That research is outside this remediation and is neither included nor performed here. No production work listed in section 9 may start until the full research is complete, every related human decision is recorded, and the resulting scope is explicitly approved.

### 8.2 Exact stop conditions

The developer must stop before production implementation and return `needs_human` if any of these applies:

- hostile ancestor mutation is in scope but no capability-rooted design/native feasibility decision has been approved;
- the requested implementation assumes ancestor symlink, mount, ownership, parent-creation, or network-filesystem policy not selected by the user;
- a proposed interface would change the public draft contract, accepted ADR, root export, or consumer warranty without explicit contract-change approval;
- the support cell to be claimed is not named and backed by a runnable real filesystem/process harness;
- Node's available primitives cannot preserve the chosen capability-rooted object authority without a native dependency and that dependency has not had architecture/security/DAG approval;
- required exclusive publication or quiescence cannot be proved for the target filesystem;
- cancellation/shutdown cleanup cannot retain authority for bounded retry after a failed reap;
- implementation would delete the output leaf/ancestor or follow an untrusted name during cleanup;
- persisted correlation data would be used as signal authority;
- a test would need to weaken an accepted invariant to pass;
- full Provider and platform conformance research is incomplete, its contradictions or required decisions remain unresolved, or the related human decisions and implementation scope have not been explicitly approved.

The developer must stop and return `BLOCKED` if prerequisite tooling, supported host primitives, or the approved native harness are unavailable and no faithful alternative can execute the required proof.

Gate 1 review completion, the contract-recording gate in section 8.3, and fresh explicit user approval of the recorded implementation scope are mandatory even when the user selects the bounded stable-ancestor route.

### 8.3 Contract-recording gate before the file plan

Section 9 is not implementation authorization. After the human owner selects a path-policy branch, a separately authorized contract stage must update the draft normative AgentManager specification and all aligned documentation to record that choice before any production work from the file plan starts. This artifact does not select that branch.

If the selected branch requires an existing parent only, or otherwise conflicts with ADR-0003's accepted rule that the manager creates missing parents, the contract stage must refine or supersede ADR-0003 rather than silently contradict it. Any other conflict with an accepted ADR likewise remains a human-governed ADR gate.

After the normative draft, aligned documentation, and any required ADR refinement or supersession agree, obtain fresh explicit approval for the exact scoped implementation. Until that approval is recorded, the developer must stop with `needs_human`; a prior architecture approval or the file list below is insufficient.

## 9. File-level plan for the next developer stage only

This plan is deliberately limited to private implementation/proof after sections 8.1-8.3 are satisfied. Paths marked “new candidate” are architectural placement guidance, not authorization to create public exports or edit contract documents. The developer must first reconcile the list against the branch at implementation time. No production work from this plan starts before full Provider and platform conformance research, related human decisions, contract recording, and fresh scoped approval are complete.

### 9.1 Runtime and application

| File/area                                                                                  | Planned change                                                                                                                                                          | Required boundary                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/runtime/execution/execution-ports.ts`                                                 | Refine the private output/execution effects only as needed to represent claimed-session authority, cleanup quiescence, and normalized cancellation completion.          | Provider-neutral; no Node/path-policy values or public export. |
| `src/runtime/execution/lifecycle.ts`                                                       | Complete deterministic arbitration for caller cancellation, deadline, natural completion, output finalization, and repeated requests. Preserve one terminal settlement. | No direct process/filesystem operations.                       |
| `src/runtime/execution/finalize-invocation-outcome.ts`                                     | Preserve late-recording semantics while integrating ordered scratch/evidence/result operations through the output session.                                              | No recursive publication retry; no process cleanup.            |
| `src/runtime/execution/process-supervision-port/*`                                         | Evolve private live-owned process effects only if required for explicit confirmed reap evidence and retained retry authority.                                           | Persisted identities remain correlation-only.                  |
| `src/application/manager/lifecycle-manager.ts`                                             | Integrate synchronous claim/private-drain registration, Option A acceptance, active-state ordering, cancellation, and terminal retention.                               | Do not expose a public manager or infer path trust.            |
| `src/application/manager/shutdown.ts` (new candidate if consistent with current structure) | Own one shared stop-accepting/drain/cleanup settlement.                                                                                                                 | No output-directory deletion or host escalation.               |
| `src/application/manager/*active*` (existing/new focused files)                            | Serialize `running`/`cancelling` saves and post-reap removal with bounded quiescence.                                                                                   | Consumer sink is storage, not signal authority.                |

### 9.2 Platform mechanics

| File/area                                                     | Planned change                                                                                                                                                              | Required boundary                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/platform/process/node-posix-process-supervision-port.ts` | Harden bounded graceful/forceful group termination, natural-exit descendant sweep, leader close/reap confirmation, and retry sharing.                                       | Linux candidate-host evidence only; Darwin remains deferred/unverified until separately implemented and proved. |
| `src/platform/filesystem/invocation-files.ts` (new candidate) | Implement the approved profile's exact absent-leaf claim, reserved-child session, owner-only scratch, bounded writes, exclusive result publication, and idempotent cleanup. | Must not silently choose ancestor policy; no leaf/ancestor deletion.                                            |
| `src/platform/filesystem/index.ts` (new candidate)            | Private barrel for the filesystem adapter after implementation exists.                                                                                                      | No root/package export.                                                                                         |
| `src/runtime/policy/*`                                        | Add only immutable limits/defaults already approved for operation bounds; do not encode a consumer threat-model default.                                                    | Any new policy value requires Gate 1 confirmation against the spec.                                             |

If the human selects the capability-rooted route, this file plan is invalidated: stop, produce a focused native feasibility/contract design, and obtain another architecture approval before coding.

### 9.3 Test support

| File/area                                               | Planned change                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `test/support/execution/fake-output-port.ts`            | Model claim/session identity, ordered cleanup/publication, pending operations, failures, and quiescence without hiding assertions. |
| `test/support/execution/fake-execution-port.ts`         | Model pending start, natural exit, cancellation acknowledgement, failed cancellation, and race ordering.                           |
| `test/support/process/fake-process-supervision-port.ts` | Model retained idempotent cleanup capability, group absence, leader reap, and unconfirmed cleanup.                                 |
| `test/support/lifecycle-conformance/*`                  | Add explicit controls for cancellation/deadline/shutdown races and exact event/result ordering.                                    |
| `test/support/filesystem/*` (new candidate)             | Narrow temporary-directory and hostile-object fixtures; no policy decisions in builders.                                           |

### 9.4 Tests

| File/area                                                                                      | Primary proof                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/runtime/execution/lifecycle.test.ts`                                                | First-cause arbitration, idempotent cancellation, deadline timer disposal, natural-exit races, and one settlement.                                                                            |
| `test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts`                  | Claim/private-drain atomicity, Option A rejection, cancellation before/after spawn and before `running`, no public residue.                                                                   |
| `test/contract/lifecycle-conformance/settlement-result-event-retention-conformance.test.ts`    | Reap-before-finalize order, late file failure, one retained result, terminal-event availability semantics.                                                                                    |
| `test/contract/manager/lifecycle.test.ts` and focused new cancellation/deadline/shutdown files | Manager-visible idempotence, active-row ordering, shared shutdown, failure-closed behavior, lookup/result state. Split each behavioral axis before suite-size triggers.                       |
| `test/unit/platform/node-posix-process-supervision-port.test.ts`                               | Signal escalation, group/leader confirmation, idempotent shared cleanup, retained retry, normalized native failures.                                                                          |
| `test/integration/platform/node-posix-process-supervision.test.ts`                             | Real child tree natural-exit sweep, cancellation, deadline, and shutdown cleanup on the candidate host.                                                                                       |
| `test/integration/platform/invocation-files.test.ts` (new candidate)                           | Exact leaf one-winner claim; file/dir/symlink conflict; reserved-child conflicts; owner-only scratch; exclusive result publication; unsupported primitive failure; only scratch/temp cleanup. |
| `test/integration/application/cancellation-shutdown-files.test.ts` (new candidate)             | Real causal order from process cleanup through filesystem finalization and no output-leaf deletion.                                                                                           |
| `test/architecture/*` or existing architecture harness inputs                                  | No provider/platform leakage into portable runtime; no forbidden dependency direction.                                                                                                        |

Tests must be written red-first. Existing deterministic fakes are contract evidence only; real process/filesystem tests are required for native claims.

## 10. Verification matrix for the developer stage

| Requirement                           | Unit                      | Contract                             | Real integration                           | Architecture/package                                 | Stop/pass rule                                         |
| ------------------------------------- | ------------------------- | ------------------------------------ | ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------ |
| Normalized absolute and bounded paths | validation partitions     | preflight rejection/no acceptance    | representative native paths                | no public claim                                      | All selected partitions pass.                          |
| Exact absent-leaf claim               | primitive/error mapping   | one winner/no adoption               | file, dir, symlink, concurrent racers      | private only                                         | Any replacement/adoption is blocking.                  |
| Ancestor policy                       | policy admission only     | no silent default                    | chosen-cell symlink/rename races           | dependency boundary                                  | No support claim before human choice and native proof. |
| Scratch/temp authority                | cleanup state             | no cleanup before reap               | substitution/conflict and mode checks      | private export                                       | Any possible leaf/ancestor deletion is blocking.       |
| Exclusive `result.json`               | result state transitions  | late-failure in-memory result        | collision, hard-link/flush, unsupported FS | package claim absent                                 | Replacing fallback is blocking.                        |
| Cancellation                          | race partitions           | state/sink/event/result order        | real group cleanup                         | no provider branches                                 | Duplicate signal/result/event is blocking.             |
| Deadline                              | fake monotonic clock      | same path as cancellation            | real bounded cleanup                       | no timer in provider                                 | Deadline bypassing reap/finalize is blocking.          |
| Natural exit                          | state partition           | descendant sweep before finalization | child leaves descendant                    | process-port boundary                                | Leader exit alone is insufficient.                     |
| Shutdown                              | shared-promise partitions | stop/drain/fail-closed               | multiple child trees and in-flight files   | no host policy                                       | Unconfirmed cleanup must reject shared shutdown.       |
| Active-state races                    | serialized fake sink      | save/quiescence/remove order         | optional consumer fixture                  | no DB types                                          | Late timed mutation or unsafe remove is blocking.      |
| Platform/filesystem cell              | N/A                       | normalized unsupported result        | CI/host-specific harness                   | support matrix docs only when approved               | Candidate host must not be generalized.                |
| Aggregate quality                     | focused runs              | owned lanes                          | owned integration lane                     | format/type/lint/coverage/build/package/architecture | `corepack pnpm verify` must exit zero before handoff.  |

Minimum developer verification sequence:

1. run each new focused test and record the expected red failure before implementation;
2. run focused unit/contract/integration files during green/refactor;
3. run `corepack pnpm test:unit`, `corepack pnpm test:contract`, and `corepack pnpm test:integration`;
4. run `corepack pnpm verify:architecture` when boundaries or imports change;
5. run `corepack pnpm format:check` for source/test/docs formatting;
6. run the full `corepack pnpm verify` before handoff;
7. report unsupported/missing host or filesystem cells as skipped, unavailable, or blocked, never passed;
8. do not claim remote CI, Sonar, public package, provider, Darwin, Windows, mount, or network-filesystem evidence unless actually run on the same head.

## 11. Gate 1 review checklist

Gate 1 should reject this architecture if it:

- chooses the user's threat model by implication;
- describes pathname preflight as hostile-TOCTOU protection;
- conflates a consumer warranty, package enforcement, and native evidence;
- allows provider adapters or platform detection to select policy;
- weakens exact-leaf non-adoption or non-replacing publication;
- allows any cleanup before confirmed process reap or any output-leaf deletion;
- treats persisted process correlation as signal authority;
- presents current private/candidate-host evidence as a public or supported-cell claim;
- authorizes developer edits to contract files or root exports in the next stage;
- lacks a stop condition for capability-rooted feasibility or unsupported filesystems.

If Gate 1 accepts the boundary, the next action is explicit user selection/approval of the implementation route and scope. Until then, this document is complete architecture, not implementation authorization.
