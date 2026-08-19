# AgentManager cross-repository extraction roadmap

- Status: Approved roadmap
- Implementation: private agent discovery/executable probing, private deterministic lifecycle/result conformance, the private Linux POSIX process-supervision and workspace-admission seam, and initial private native-Codex execution slices are implemented and tested; the provider-neutral filesystem/output layer, manager-level cancellation/shutdown settlement, frozen real-process harness, Codex adapter conformance, and public-package work remain target or deferred
- Target package: `@revisium/revo-agent-runtime`
- Publication: npm publication remains disabled until the Complete unpublished public package candidate is approved
- Source repository: `revo-agent-runtime`
- Consumer repository: sibling `orchestrator`

## 1. Purpose and source of truth

This roadmap sequences the extraction of one portable, process-local `AgentManager` from the sibling orchestrator into this
package. It is a delivery plan, not a public API and not a replacement for the normative
[AgentManager v1 target specification](./specs/agent-manager-v1.spec.md). The accepted B+ private migration is controlled by
[ADR-0013](./adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md) and the
[execution-handoff specification](./specs/execution-handoff.spec.md); neither describes shipped behavior.

When sources disagree, follow the order in the [repository contract](../REPOSITORY.md): implemented source, tests, and the
public export map describe shipped behavior; accepted ADRs own durable architecture decisions; stable and draft specs own
their respective contract status. This roadmap may be revised when explicit research changes sequencing, but it MUST NOT make
an unimplemented target appear shipped. The root export remains empty until the provider-neutral shared core, its filesystem/output layer, the provider-neutral
frozen real-process harness, and the first supported provider adapter (native Codex) are complete, and the Complete
unpublished public package candidate proof passes. Native Claude and ACP remain required adapters to the same
provider-neutral contract and are delivered after the public export.

The boundary is already decided by [ADR-0001](./adr/0001-agent-runtime-boundary.md),
[ADR-0002](./adr/0002-agent-manager-consumer-boundary.md),
[ADR-0003](./adr/0003-invocation-output-recording.md), and refined by
[ADR-0008](./adr/0008-real-mechanics-supervision-boundary.md) and
[ADR-0009](./adr/0009-process-signal-authority.md). [ADR-0010](./adr/0010-consumer-warranted-stable-output-ancestors.md)
amends the output-hierarchy rule. [ADR-0011](./adr/0011-consumer-governed-local-supervision.md) records completed retention,
consumer-governed admission/listeners, workspace authorization, authoritative local cleanup, and platform rollout.
[ADR-0013](./adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md) records B+ sealed intent,
preregistered capability-bound execution, paused-I/O acceptance, and one terminal authority. Research may refine the draft
public specification. A finding that
changes an accepted decision requires a new refining, amending, or superseding ADR and human approval before implementation
continues.

## 2. Fixed decisions

The roadmap carries these approved constraints:

1. The AgentManager v1 draft is the target contract. It changes only through explicit, recorded research.
2. Roadmap responsibilities may merge sequentially, but intermediate merges do not create a public or published API.
3. The package MUST remain unpublished on npm until the Complete unpublished public package candidate is complete.
4. The root export MUST remain empty until the provider-neutral frozen real-process harness passes and native Codex — the
   first supported provider adapter — instantiates it without exclusions. The Complete unpublished public package candidate
   adds the complete curated **provider-neutral** public surface only after implementation, declarations, examples,
   conformance, and package proof agree. The public surface MUST NOT contain a Codex-specific type, entrypoint, convenience
   API, or provider-specific lifecycle contract.
5. The **provider-neutral public AgentManager contract** MAY be exported once native Codex instantiates and passes the one
   shared conformance harness in addition to its wire-specific tests. **Provider coverage MUST NOT be called complete**
   until native Claude and ACP also instantiate and pass that same shared harness with their wire-specific tests. Contract
   completeness and provider coverage are separate claims and MUST be stated separately in the README and release notes.
6. Contract decision research and Human approval of contract decisions are non-waivable. Private agent discovery and executable probing additionally requires closure
   of only the Provider and platform conformance research evidence or contradiction that directly
   affects its executable-probe literals and platform-unavailable contract. The provider-neutral Linux/local-`ext4` POSIX core
   is a second bounded exception: cancellation/deadline/shutdown and filesystem-publication work may proceed through
   package-owned real-process fixtures and a generic adapter seam after its governing decisions and Linux/local-`ext4` fixture
   prerequisites are approved. This exception makes no Codex, Claude, ACP, provider wire/version, or supported-cell claim. Full
   Provider and platform conformance research remains non-waivable before Supported-cell closure and each native provider
   adapter conformance work item that consumes it.
7. The root session orchestrates human gates. The package reports technical results and typed faults; it does not approve,
   persist, resume, or advance a durable human gate.
8. Cross-repository cutover is one-way. One-way orchestrator cutover does not introduce dual routing, compatibility fallbacks, or implicit provider
   selection.
9. One process-local manager may supervise multiple consumer invocations, but every accepted invocation has one root process
   tree. `ProcessManager` and `ManagedProcess` remain private TypeScript/Node mechanics.
10. `launch.versionProbe` is required. Each start freshly resolves and proves strict SemVer immediately before output-leaf
    claim and invocation spawn, then launches the resolved absolute executable. Path/version launch evidence and ADR-0006
    post-spawn process fingerprints have separate purposes.
11. Events are lifecycle-only; `invocation.finished` signals result availability through the result APIs. Bounded redacted
    streams, raw response, typed terminal result, and exact invocation files remain their own contracts.
12. This documentation decision records no implementation, provider/CI/platform conformance, or root export. Per
    [ADR-0011](./adr/0011-consumer-governed-local-supervision.md), v1 has no package active-invocation cap or internal admission
    queue, and synchronous listeners have no package queue, worker pool, or numeric fanout limit. The consumer owns admission,
    concurrency, listener cost, downstream buffering, fanout, and backpressure.
13. ADR-0009 requires Option A pre-acceptance cleanup: confirmed cleanup rejects `start()` without public invocation, while
    unconfirmed identity/save reap retains a private guard/reservation for shutdown retry and external consumer resolution.
    A rejected setup leaf is consumer-owned quarantined residue; retry uses a fresh output path.
14. ADR-0010 assigns output-hierarchy provisioning and a trusted stable-ancestor warranty through terminal filesystem
    quiescence to the consumer. The manager creates only the absent final leaf; hostile-ancestor support remains deferred.
15. ADR-0011 fixes retained completed FIFO capacity at minimum 1, default 1,000, and maximum 1,000; construction may select a
    lower value, while active invocations neither occupy nor evict retained-completed capacity.
16. ADR-0011 treats the consumer-authorized workspace as a bounded normalized absolute existing directory and creates no
    package certification of realpath/symlink topology, containment, ownership, provenance, hostile rebinding, or a
    workspace/output relationship.
17. ADR-0011 makes `cancelling` persistence and provider graceful-cancellation dispatch best-effort and non-blocking.
    Caller cancellation, deadline, and shutdown use the provider-neutral hook only when available for a cancellation-capable
    definition, without drain; a false capability or missing/failed hook takes the same immediate local path. Authoritative
    owned-POSIX-group cleanup uses `SIGTERM`, at most 2 seconds of grace, conditional `SIGKILL`, and confirmed group absence plus
    leader reap for cancellation, deadline, shutdown, natural-exit sweep, and recovery; first-terminal arbitration remains
    authoritative.
18. ADR-0013 fixes the B+ phase order: complete deterministic preclaim preparation; preregister claim, output preparation,
    and process start before dispatch; bind attested resources through authentic invocation-bound one-use carriers; accept
    after identity and initial save while I/O is paused; then register one duplex coordinator and activate exactly once.
19. Exact parser reasons, fixed private claim/preparation/duplex/protocol/parser/cleanup bounds, ADR-0003-partitioned raw
    eligibility, cleanup-before-terminal precedence, and separate non-replacing raw/result publication are package-private
    contract, not new public options.
20. B+ migration replaces old private execution, I/O, normalization, and publication seams atomically at their cutover. No
    compatibility overload, alias, old/new completion path, dual publication authority, or eager/paused production path may
    remain active.

## 3. Extraction approaches

| Approach                                              | Advantages                                                                                                                                                              | Costs and risks                                                                                                                                                | Decision                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Contract-first vertical spine                         | Establishes provider-neutral identity, lifecycle, result, security, process, and file semantics before provider specialization; makes one shared harness authoritative. | Provider execution appears later; contract and portability questions must be answered before implementation.                                                   | **Selected.** It best matches the accepted package boundary and final conformance gate. |
| Provider-led work items: Codex, then Claude, then ACP | Produces an early demonstrable provider path and can reuse parser fixtures quickly.                                                                                     | The first provider can bias the shared core; cancellation, files, faults, and events are likely to be recut for later providers.                               | Rejected because it weakens the shared-contract-first completion rule.                  |
| Move legacy subsystems, then recut them               | Preserves more legacy source and tests at the first merge.                                                                                                              | Imports ambient environment, unbounded buffering, consumer path ownership, Nest composition, product result fields, and provider-id dispatch into the package. | Rejected because temporary coupling would contradict the target architecture.           |

The selected approach grows vertically through the target dependency direction in [architecture.md](./architecture.md):
portable specification as the dependency leaf; definition and registry identity above it; execution through package-owned
ports; strategy and platform adapters behind those ports; application as the only composition layer.

## 4. Package, consumer, and durable human-gate boundary

| Package owns                                                                                                                                               | Consumer owns                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation, canonical copying, digesting, exact registry lookup, and immutable execution pins.                                                             | Durable definition storage, rollout, and exact agent, model, profile, prompt, workspace, permission, and result-schema selection.                                                                                                  |
| One native or ACP physical invocation, explicit child environment, bounded streams, deadlines, cancellation, process-tree termination, and confirmed reap. | Runs, tasks, steps, attempts, scheduling, durable retry, replay, workflow persistence, and restart recovery.                                                                                                                       |
| Provider-neutral events, usage, diagnostics, typed faults, result validation, bounded completed retention, and process-local shutdown.                     | Product verdicts, billing, routing, gates, user-facing projections, and durable indexing.                                                                                                                                          |
| Exclusive recording in one exact consumer-supplied output directory, including manager-owned scratch and atomic non-replacing `result.json`.               | Output path construction, parent-hierarchy provisioning, stable-ancestor warranty through filesystem quiescence, retention, crash-residue recovery, and the durable association between an attempt and its exact output directory. |
| Provider protocol, parser, and permission translation behind package-owned adapters.                                                                       | DBOS, Prisma, Nest, GraphQL, MCP, the orchestrator lifecycle CLI, Git, GitHub, worktree allocation, and deterministic system operations.                                                                                           |

A technically successful JSON result MAY contain consumer-defined values such as `blocked` or `needs_human`. The package
validates and returns that object but MUST NOT interpret it as a workflow transition. During One-way orchestrator cutover, the orchestrator maps the
result into its durable attempt record and, when consumer policy requires human action, creates or resumes the durable human
gate through its existing workflow boundary. Manager cancellation and shutdown do not close, approve, or bypass such a gate.

When `revo.agent.shutdown_failed` reports unresolved manager-owned process cleanup, the consumer retains ADR-0002's
host-termination obligation and does not create a replacement manager in the same supervision domain until that cleanup is
resolved. Output uncertainty instead quarantines only the affected invocation id/path and extends its stable-ancestor warranty
without a global replacement ban. Active-state uncertainty preserves the affected id/row for consumer-backed reconciliation
by a fresh manager.

## 5. Legacy reuse policy and matrix

The sibling orchestrator is evidence, not the target source of truth. Port observable behavior, hostile-input partitions, and
small pure mechanics only after the target contract owns their bounds and types. Do not copy a module merely to preserve its
class, dependency injection, directory layout, or product-facing result shape. Every port starts with a target-owned failing
test and removes consumer imports.

All paths in the following table are **sibling-repository paths**, relative to this document through `../../orchestrator/`.

| Legacy source                                                                                                                                                    | Reusable evidence                                                                                                                                                                      | Required recut or exclusion                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../orchestrator/src/observability/activity-signal.ts` and adjacent test                                                                                      | Counter updates, byte accounting, snapshots, and idempotent operation-id set behavior.                                                                                                 | This is counter/idempotency evidence only. It does not establish heartbeat or operation activity as AgentManager idle-time semantics; Contract decision research owns that decision. Exclude run-level aggregation and consumer activity types.                                  |
| `../../orchestrator/src/acp/jsonrpc/canonicalizer.ts`, `framer.ts`, `parser.ts`, `connection.ts`, and adjacent tests                                             | JSON isolation, fragmented UTF-8 framing, frame bounds, message validation, request correlation, duplicate and unknown response handling, close behavior, and hostile-prototype tests. | Recut to package faults and limits. Bound pending requests and transport writes; the legacy write queue is not the package subscription/backpressure contract.                                                                                                                   |
| `../../orchestrator/src/acp/protocol/**`, `session/**`, and adjacent tests                                                                                       | Protocol value parsing, lifecycle ordering, capability checks, foreign-session rejection, permission requests, and close behavior.                                                     | Remove Nest decorators and host composition. Reconcile every protocol value with the Provider and platform conformance research ACP version and provider-neutral public boundary.                                                                                                |
| `../../orchestrator/src/acp/prompt-execution/prompt-outcome-collector.ts` and adjacent test                                                                      | First-terminal-wins, foreign-session rejection, duplicate-terminal rejection, usage replacement, and diagnostic partitioning.                                                          | Bound text and diagnostic accumulation, remove Nest, and map to the shared result/event contract. Do not port unbounded arrays.                                                                                                                                                  |
| `../../orchestrator/src/acp/runtime/invocation.ts`, `invocation.types.ts`, `connector.ts`, and tests                                                             | Failure latching, inbound failure racing, session isolation, permission and diagnostic flow, and completion-barrier scenarios.                                                         | The legacy runtime injects `openConnection`; `connector.ts` configures a session but does not spawn a real ACP process. ACP adapter conformance must add a real stdio process connector behind Real process, filesystem, security, cancellation, and shutdown conformance ports. |
| `../../orchestrator/src/worker/codex-runner.ts` and adjacent test                                                                                                | Codex JSONL variants, terminal candidate extraction, failure events, and usage-field extraction.                                                                                       | Separate transport parsing from `verdict`, `nextSteps`, and `needsHuman`; add target byte and item bounds; remove unbounded received/buffered stream copies and orchestrator imports.                                                                                            |
| `../../orchestrator/src/worker/result-envelope.ts`, `claude-code-runner.ts`, and adjacent tests                                                                  | Claude stream-json terminal-result selection, transport envelope parsing, terminal metadata, and usage extraction.                                                                     | Port only provider transport behavior. Exclude role prompts, worktree policy, tool allow/deny policy, verdict schema, next-step normalization, and attempt-result mapping.                                                                                                       |
| `../../orchestrator/src/worker/process-executor.ts` and adjacent test                                                                                            | Timeout scenario partitions, stdout/stderr activity counters, detached-process experiments, and process fixture ideas.                                                                 | Do not copy the executor: it merges `process.env`, accumulates stdout/stderr without a hard bound, lacks the target cancellation contract, and does not prove authoritative cross-platform kill/reap ownership.                                                                  |
| `../../orchestrator/src/worker/artifact-store.ts` and adjacent test                                                                                              | File naming and basic redaction/tail test ideas.                                                                                                                                       | Do not copy the store: it derives run/attempt paths, recursively adopts existing directories, overwrites files, appends without file bounds, and lacks exclusive result publication.                                                                                             |
| `../../orchestrator/src/observability/agent-activity-reporter.ts`, `src/runners/runner-manifest.ts`, `src/worker/runner-dispatch.ts`, and `src/worker/runner.ts` | Consumer-mapping scenarios for One-way orchestrator cutover.                                                                                                                           | Keep outside the package. They own run/attempt identity, persistence delivery, provider-id dispatch, role policy, verdicts, next steps, and human-gate signals.                                                                                                                  |

## 6. Non-waivable research and decision gates

### Contract decision research

**Entry:** the current draft specification, accepted ADRs, architecture, testing policy, and the legacy evidence matrix above.

Contract decision research produces evidence-backed answers for remaining contract gaps. It does not write production code.
The approved real-mechanics documentation contract now owns fresh version-probe preflight, lifecycle-only events,
first-commit terminal arbitration, terminal-only idle timing, the exact streaming-redaction algorithm, consumer-warranted
stable output ancestors through terminal filesystem quiescence, and the decisions recorded by ADR-0011. On 2026-08-19,
human approval closed B+ and ADR-0013; the accepted private contract is `docs/specs/execution-handoff.spec.md`. Remaining research
covers hostile-output-ancestor support, provider versions and wires, the macOS native cell/evidence, Windows future design,
CI evidence, and the required shared-conformance evidence classes.

**Exit:** every Human approval of contract decisions item has one explicit decision, supporting source or experiment, affected
specification clauses, and an identified verification owner. If evidence contradicts an accepted ADR, Contract decision research
returns an ADR candidate instead of silently changing the draft.

### Human approval of contract decisions

Human approval of contract decisions is non-waivable. The complete program requires one human-approved decision for every checkbox.
Private agent discovery and executable probing may begin after its governing subset and the directly relevant Provider and platform
conformance research check are approved; the dated record below identifies that subset. Every remaining checkbox must close before
the later roadmap responsibility that consumes it.

- [x] The supported JSON Schema draft 2020-12 surface is closed precisely, including unknown properties, `$ref`, vocabularies,
      formats, and bounded diagnostics; the evaluator and RFC 8785 dependency or package-owned implementation are approved.
- [x] `capabilities.cancellation: false` has the best-effort provider-dispatch and immediate authoritative local-cleanup
      behavior recorded by [ADR-0011](./adr/0011-consumer-governed-local-supervision.md).
- [x] B+ acceptance is fixed after deterministic preclaim preparation, preregistered claim/preparation/start, spawn identity,
      and fulfilled initial `running` save while I/O remains paused; handle creation precedes sole-coordinator registration and
      one-use activation, and every losing path has confirmed or authentic retained ownership.
- [x] One duplex coordinator preserves exact parser observations and arbitrates simultaneous cancellation, wall/idle timeout,
      process exit, protocol/result failure, cleanup, and publication through first successful terminal commit without a
      pre-commit priority matrix.
- [x] Streaming redaction defines literal and built-in patterns, `[REDACTED]` replacement text, per-channel 64 KiB carry,
      leftmost-longest overlap selection, final flush, mutable-buffer clearing, and all pre-sink applications.
- [x] Workspace and CWD rules define consumer authorization, absolute normalization, existence, directory type, intentionally
      absent package realpath/symlink/containment/ownership/provenance certification, and no implied workspace/output
      containment ([ADR-0011](./adr/0011-consumer-governed-local-supervision.md)).
- [x] Output ancestors are consumer-provisioned, trusted, and stable through terminal filesystem quiescence; the manager
      creates only the absent final leaf and makes no hostile-ancestor safety claim.
- [x] Active-invocation admission/concurrency and synchronous listener cost/fanout/buffering/backpressure are consumer-governed;
      the package adds no admission queue, listener queue/pool, or numeric active/listener limit
      ([ADR-0011](./adr/0011-consumer-governed-local-supervision.md)).
- [x] Idle timing is terminal-only: stdout, stderr, valid protocol frames, listeners, file work, and internal timers do not
      reset it. Legacy heartbeat and operation counters are not adopted.
- [ ] The proposed provider-version and OS/filesystem support matrix for Provider and platform conformance research is explicit,
      including unsupported-cell behavior.
- [ ] Shared-conformance evidence is classified as deterministic real-process fixtures, credentialed live-provider runs, or a
      required combination; missing credentials are never reported as a pass.

#### Platform rollout decision record — 2026-07-31

Human approval sets the following implementation and evidence sequence. It is not a current compatibility claim: a cell becomes
supported only after its required native process/filesystem and provider conformance evidence passes. The decision is recorded
by [ADR-0011](./adr/0011-consumer-governed-local-supervision.md).

- The first implementation and native-conformance target is a Linux host with a local `ext4` filesystem. This MVP slice uses
  Node's built-in `child_process` with package-owned Linux process-group supervision; it does not add `execa`, `cross-spawn`,
  DBOS, Docker-based OS emulation, or `systemd`/`launchd` as a mandatory invocation backend.
- macOS follows as a separate native implementation and validation slice on a colleague-host. Its exact filesystem cell is chosen
  only from observed host evidence; it is not supported or inferred from Linux evidence.
- Windows is explicitly outside the MVP. Until a separately approved Windows process/filesystem design and native evidence exist,
  it remains unsupported and follows the existing `revo.agent.platform_unsupported` preflight path before output-leaf claim or
  process spawn.

The unchecked matrix item remains open because provider versions, the macOS cell, and all required conformance evidence are not
yet recorded.

#### Private agent discovery and executable probing entry decision record — 2026-07-20

Human approval closed only the Human approval of contract decisions and Provider and platform conformance research decisions needed
for Private agent discovery and executable probing. Unchecked Human approval of contract decisions items remain mandatory before the
later roadmap responsibility that consumes them.

- [x] Package DTO and consumer-schema engines are `zod@4.4.3` and `ajv@8.20.0`; the closed consumer-schema profile is this
      responsibility's schema surface ([ADR-0004](./adr/0004-separate-validation-engines.md)).
- [x] RFC 8785 identity uses exactly `canonicalize@3.0.0`. A project-owned audit means checked-in repeatable evidence for
      the frozen lock and installed tree, artifact integrity/license, runtime DAG/install scripts, Node/ESM/types, production
      advisories, and RFC expected/hostile vectors ([ADR-0005](./adr/0005-audited-jcs-definition-identity.md)).
- [x] Explicit probing has one manager-scoped active physical-probe bound of eight and the approved FIFO/batch-wave behavior;
      Private agent discovery and executable probing verifies it only through the package port and deterministic fake.
- [x] The Provider and platform conformance research review for Private agent discovery and executable probing found no
      contradiction affecting executable-probe literals or the platform-unavailable contract. From the `revo-agent-runtime`
      repository root, `../orchestrator/src/control-plane/run-profile-contract.ts` defines `RunnerManifest` without a
      version-probe field and `../orchestrator/src/runners/runner-manifest.ts` pins only `executionFields.command`; there is
      no legacy manifest version-probe behavior to preserve. This responsibility therefore makes no platform-support claim.
      Real PATH, process, OS/filesystem, provider-version, wire, permission, cancellation, and completion evidence remains
      required by Real process, filesystem, security, cancellation, and shutdown conformance and the provider adapter
      conformance work items.

The dirty or untracked state of these approved planning documents is intentional working-tree context, not a Private agent discovery
and executable probing entry blocker. The AgentManager v1 specification remains Draft, and this decision record does not represent
Private agent discovery and executable probing as a complete public implementation.

No implementation responsibility starts until its governing Human approval of contract decisions are approved. A later Provider and
platform conformance research contradiction returns to Contract decision research and requires a new Human approval of contract
decisions approval for the affected decisions.

### Provider and platform conformance research

**Entry:** approved Human approval of contract decisions and an explicit proposed support matrix.

Provider and platform conformance research records exact versions, direct-no-shell argv, delivery modes, wire fixtures, permission
behavior, usage fields, cancellation behavior, and process ownership for every provider adapter:

| Provider adapter | Required protocol/result evidence                                                                                                                                   | Required cancellation and permission evidence                                                                                    | Required completion evidence                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Codex     | Exact supported `codex` version/probe, argv, JSONL frames, terminal structured-result variants, failure frames, and usage fields.                                   | Native cancellation/process-tree behavior and exact mapping of provider permission inputs to CLI arguments.                      | Captured bounded fixtures plus the approved live or deterministic evidence class; Native Codex adapter conformance later instantiates the shared harness.  |
| Native Claude    | Exact supported `claude` version/probe, argv, stream-json events, terminal envelope, error/denial fields, and usage fields.                                         | Native cancellation/process-tree behavior and exact permission/tool argument mapping without importing orchestrator role policy. | Captured bounded fixtures plus the approved live or deterministic evidence class; Native Claude adapter conformance later instantiates the shared harness. |
| ACP              | Exact ACP protocol version, initialization/session/prompt/close messages, framing, correlation, permission requests, usage updates, diagnostics, and hostile input. | Protocol cancellation or close behavior plus authoritative fallback process termination; session and process isolation.          | A real stdio connector design and fixtures; ACP adapter conformance later instantiates the shared harness.                                                 |

Provider and platform conformance research also completes the cross-product below. A cell is `required` only when Human approval of
contract decisions declares it supported; unsupported cells require a stable preflight or construction outcome and documentation,
not a skipped test disguised as success.

| Platform/filesystem cell              | Process evidence                                                                                        | Filesystem/security evidence                                                                                                          | Provider coverage                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Linux on local `ext4`                 | First target: direct spawn, signal/process-tree termination, confirmed reap, timeout, and cancellation. | Owner-only scratch, exclusive leaf, bounded files, hard-link result publication, file/directory flush behavior, and cleanup ordering. | Every provider later declared supported on this cell. |
| macOS filesystem cell to be evidenced | Later separate native process-group, confirmed-reap, timeout, and cancellation evidence.                | A cell selected from the native host; Linux filesystem evidence is not reused.                                                        | Every provider later declared supported on that cell. |
| Windows outside MVP                   | Unsupported pending a separately approved future process/filesystem design and native evidence.         | Fail closed before output-leaf claim or process spawn; no current filesystem-support claim.                                           | None in MVP.                                          |

**Partial exit for Private agent discovery and executable probing:** executable-probe literals and the stable
platform-unavailable partition have no unresolved contradiction. Missing provider wire, permission, cancellation, process-ownership,
or filesystem evidence does not block this responsibility because it uses only a fake executable-probe port.

**Partial exit for the provider-neutral Linux/local-`ext4` POSIX core:** the governing process-supervision and filesystem
decisions are approved, package-owned Linux/local-`ext4` real-process fixtures can exercise the generic adapter seam, and no
contradiction affects that scoped core. Provider versions, wires, permissions, usage, and provider cancellation/completion
semantics may remain unresolved because this exit authorizes no Codex, Claude, ACP, native-adapter, or supported-cell claim.

**Full exit for Supported-cell closure and the provider adapter conformance work items:** all supported cells have reproducible
observations and bounded fixtures; exact provider versions are recorded; every unsupported cell has a stable contract; and every
contradiction has completed the Contract decision research and Human approval of contract decisions loop. Full Provider and
platform conformance research is non-waivable before supported-cell closure and native provider adapter conformance work even if
package-owned fixtures or legacy provider tests are green.

## 7. Corrected responsibility graph

The approved B+ migration is deliberately narrower than a provider rollout. Canonical documentation alignment is the entry
gate for package-private product-code migration; every following stage remains target work and does not change the empty root
export. Intermediate pull requests MAY build inactive internals, but no merge may activate old and new execution, I/O,
normalization, completion, or publication paths concurrently. Full Provider and platform conformance research remains a
non-waivable prerequisite for supported-cell closure and native provider adapter conformance.

| Sequence | Target responsibility                | Entry gate                                                                                  | Exit boundary                                                                                                                                                                                                    |
| -------- | ------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Canonical B+ documentation           | Approved 2026-08-19 B+ decision and docs-only route.                                        | ADR-0013, the accepted private execution-handoff spec, AgentManager target, architecture, roadmap, testing, review, repository, and indexes agree without a code/export/support claim.                           |
| 2        | Private contract and carrier cutover | Canonical B+ documentation.                                                                 | Execution-owned ports and package-authentic one-use carriers replace old private call shapes at their cutover; inactive scaffolding does not create a compatibility production path.                             |
| 3        | Output claim and preparation         | Private contract/carrier cutover.                                                           | Preregistered claim/preparation settlement, retained identical authorities, attested resources, output-port-only destinations, deferred protocol bind, and filesystem quiescence pass provider-neutral fixtures. |
| 4        | Process start, pause, and activation | Output claim/preparation plus package-owned Linux/local-`ext4` process fixtures.            | Preregistered spawn, actual-spawn timers, paused I/O, one setup deadline, identity/save acceptance, one-use activation, and confirmed-or-retained cleanup pass without a supported-cell claim.                   |
| 5        | Duplex parser and normalization      | Process start/pause/activation.                                                             | One coordinator, bounded backpressure, exact nine-reason parser taxonomy, copied evidence, public-fault mapping, and normalization without reparsing pass the provider-neutral harness.                          |
| 6        | Final publication and shutdown       | Duplex/parser/normalization.                                                                | ADR-0003 raw eligibility, separate non-replacing raw/result publication, cleanup/precedence, completed-record/event ordering, concurrent drainage, and retained-authority failure paths pass.                    |
| 7        | Supported-cell closure               | Completed provider-neutral B+ harness plus full Provider and platform conformance research. | Every claimed cell has explicit approved native evidence; every other cell fails closed before claim/spawn. The first closure target remains Linux/local-`ext4` for Native Codex.                                |

Residual blockers remain: hostile-output-ancestor support, provider versions/wires, the macOS native cell/evidence, Windows
future design, CI evidence, shared-conformance evidence classification, and any other unrecorded supported-cell evidence. No
stage may treat an unsupported or untested cell as passed.

```text
Canonical B+ documentation
        |
        v
Private contract and carrier cutover
        |
        v
Output claim and preparation
        |
        v
Process start, pause, and activation
        |
        v
Duplex parser and normalization
        |
        v
Final publication and shutdown
        |
        v
Provider-neutral frozen real-process harness
        |
        v
Native Codex adapter conformance + Codex/Linux supported-cell closure
        |
        v
Complete unpublished public package candidate  (provider-neutral root export)
        |
        v
Human approval of the exact package artifact and consumer candidate
        |
        v
One-way orchestrator cutover
        |
        v
Native Claude adapter conformance      (later adapter, same contract, same harness)
        |
        v
ACP adapter conformance                (later adapter, same contract, same harness)

Provider and platform conformance research --> Codex/Linux supported-cell closure
Provider and platform conformance research --> Native Codex adapter conformance
Provider and platform conformance research --> Native Claude adapter conformance
Provider and platform conformance research --> ACP adapter conformance
Contract-research contradiction -----------> Contract decision research and Human approval of contract decisions
```

After the provider-neutral frozen real-process harness, provider adapters remain strict and ordered: Native Codex, then
Native Claude, then ACP. Native Codex is the only adapter required before the public export; Native Claude and ACP follow
it after the export. Completion of one adapter does not relax the next adapter's evidence or its full harness suite, and a
later adapter MUST instantiate the already-published provider-neutral contract without altering it. If a later adapter
cannot satisfy the published contract, that is a contract defect requiring Contract decision research, a new ADR, and human
approval — not an ad-hoc public-surface change.

### Private agent discovery and executable probing

**Entry:** the Human approval of contract decisions that govern this responsibility are approved. Provider and platform
conformance research has no unresolved contradiction affecting executable-probe literals or the platform-unavailable result
partition. The dated Private agent discovery and executable probing entry decision record above is the file-backed evidence for
this gate. Full Provider and platform conformance research completion is not an entry condition for this responsibility.

**Owns:** strict package DTO validation; the hardened closed consumer-schema profile; complete-set all-or-nothing definition
validation; canonical package-owned copies; RFC 8785 digest; sealed exact registry; deterministic unsigned-UTF-8 listing;
explicit single and batch probes; and one bounded fair executable-probe scheduler through a fake port.

**Exit:** unit and contract tests prove closed consumer-schema profile and resource rejection, bounded normalized diagnostics,
duplicate and incoherent definitions, exact lookup without latest/fallback, caller mutation isolation, deterministic digests/order,
batch prevalidation and duplicate coalescing, shared FIFO fairness and the fixed active bound of eight, strict version parsing,
bounded probe output, requested timeout termination/reap, and stable probe precedence through the fake port. This responsibility
checks only static definition/template/delivery/probe-literal coherence. Dynamic parameter/default/prompt/schema argv expansion
belongs to Deterministic lifecycle and result conformance. Provider permission expansion belongs to the three provider adapter
conformance work items. Real probe process ownership and integration belong to Real process, filesystem, security, cancellation,
and shutdown conformance. Architecture verification proves the intended dependency direction. The root export is still empty.

**Status:** This private discovery-and-probing implementation is tested. The package remains unpublished and the root export
remains empty; this roadmap responsibility does not make the public AgentManager available or advance the remaining real
process/filesystem/security/cancellation/shutdown, provider-adapter, and public-package work.

### Deterministic lifecycle and result conformance

**Status:** Implemented and tested privately through PR #24–28, ending at `01a5d55`. It proves only deterministic fake
execution/file ports and a provider-neutral base shared conformance harness; it does not prove a real child process, secure
filesystem publication, production cancellation/kill/reap/shutdown, streaming redaction, provider success, or a public export.

**Entry:** Private agent discovery and executable probing is green.

**Owns:** an internal AgentManager composition using deterministic fake execution and file ports; dynamic
parameter/default/prompt/schema argv expansion; the accepted-to-terminal state machine; immutable request snapshots; result
parsing/object/closed consumer-schema-profile decisions behind ports; completed lookup/wait/handle identity; synchronous event ordering; and the
**base shared conformance harness** that future adapters must instantiate.

**Exit:** the fake ports prove preflight rejection versus post-acceptance typed completion, exactly one terminal transition,
the same immutable result through handle/lookup/wait paths, terminal-event result availability, and bounded FIFO completed retention. The harness expresses
provider-neutral scenarios without branching on `codex`, `claude`, or `acp`.

Deterministic lifecycle and result conformance MUST NOT claim a real child process, secure filesystem publication, production cancellation, kill/reap, streaming
redaction, or provider success. It is an internal lifecycle/result proof only. The root export remains empty.

### Real process, filesystem, security, cancellation, and shutdown conformance

**Entry:** Deterministic lifecycle and result conformance base harness green; the governing process-supervision and filesystem
decisions are approved; and package-owned Linux/local-`ext4` real-process and filesystem fixtures are available. This entry is
limited to the provider-neutral POSIX core and generic adapter seam. Full Provider and platform conformance research remains
required before Supported-cell closure and native provider adapter conformance; no provider wire/version or supported-cell
claim follows from this entry.

**Owns:** the provider-neutral Linux/local-`ext4` B+ core through package-owned real-process/filesystem fixtures and a
generic adapter seam. Its work is grouped and ordered as follows:

1. **Preclaim:** one registry read, complete definition/binding/coherence/schema/permission/environment/workspace/platform/probe
   and prospective-bound work, exact secret-substring checks, and no mutation on deterministic failure.
2. **Output:** preregistered exclusive claim and preparation, identical retained authorities, attested scratch/evidence
   resources, output-port-only redaction/raw destinations, one-use security transfer, deferred zero-buffer protocol bind, and
   filesystem quiescence.
3. **Process and duplex:** preregistered direct spawn with piped stdin, actual-spawn timers, paused stdout/stderr, one setup
   deadline, identity/save acceptance, one-use coordinator activation, bounded protocol/backpressure, and confirmed-or-retained
   natural/cancelled cleanup.
4. **Parser and result:** all nine exact parser reasons, copied duplex evidence, one first-successful-commit arbiter, unchanged
   public mapping, exact consumer-schema validation, and normalization without reparsing.
5. **Active state and acceptance:** no public state before atomic acceptance/handle creation, exact maybe-persisted save
   reconciliation, accepted-result handling when activation fails, and separate fresh-fingerprint recovery authority.
6. **Cleanup and shutdown:** cleanup-before-terminal commit, ADR-0003-partitioned raw evidence, separate non-replacing raw/result
   publication, exact precedence, completed-record/event ordering, concurrent operation-owned drainage, and failed-closed
   retained claim/cleanup ownership.

It owns no Codex, Claude, ACP, other provider wire/version behavior, public export, or supported-cell declaration.

**Exit:** the provider-neutral harness proves every applicable conformance obligation in the accepted
[execution-handoff specification](./specs/execution-handoff.spec.md), including authentic carrier rejection, exact parser
reasons, no raw-byte bypass, retained-authority races/quiescence, non-replacing raw/result publication, and absence of any old
compatibility overload, alias, eager/paused dual path, dual publication authority, or second completion/normalization path.
Linux/local-`ext4` evidence remains candidate-host evidence until supported-cell closure; missing native/provider/CI/Sonar
evidence is blocked or skipped, never passed. The root export remains empty.

### Native Codex adapter conformance

**Entry:** The provider-neutral frozen real-process harness passes; Codex provider/platform evidence is approved. Native
Codex is the first real provider adapter after that shared proof.

**Exit:** the native Codex adapter instantiates the provider-neutral frozen real-process harness without exclusions and
passes Codex-specific argv, permission, JSONL hostile/malformed/overflow, terminal selection, failure classification, usage,
cancellation, and version tests. No Codex-specific public contract is added.

### Native Claude adapter conformance

**Entry:** Native Codex adapter conformance passed the provider-neutral frozen real-process harness; Claude provider/platform
evidence is approved.

**Exit:** the native Claude adapter instantiates the provider-neutral frozen real-process harness without exclusions and
passes Claude-specific argv, permission/tool, stream-json hostile/malformed/overflow, terminal envelope, denial/error,
usage, cancellation, and version tests. Orchestrator role/worktree policy remains outside the adapter.

### ACP adapter conformance

**Entry:** Native Claude adapter conformance passed the provider-neutral frozen real-process harness; ACP provider/platform
evidence is approved.

**Exit:** the ACP adapter uses a real invocation-scoped stdio process connector, instantiates the provider-neutral frozen
real-process harness without exclusions, and passes ACP-specific framing, correlation, hostile input, permissions,
cancellation/close, diagnostics, bounds, completion barrier, and session/process isolation tests. Pooling and
cross-invocation session reuse remain deferred.

### Complete unpublished public package candidate

**Entry:** the provider-neutral frozen real-process harness passes; Native Codex adapter conformance passes that harness
without exclusions plus its wire-specific suite; and Codex/Linux supported-cell closure is approved. Native Claude and ACP
adapter conformance are **not** entry conditions and are delivered after this responsibility.

**Owns:** the complete curated root exports, public types, declarations, consumer examples, final documentation reconciliation,
and exact packed-package proof.

**Exit:** runtime, contract, integration, architecture, type-surface, declaration, export, packed ESM/strict-TypeScript
consumer, deep-import denial, content, coverage, and full repository verification pass on the same head. The specification no
longer describes implemented behavior as unavailable. AgentManager may now be called complete, but the npm package remains
unpublished. The README, specification, and release notes MUST state the exact supported provider/platform coverage of this
export (native Codex on the approved Linux cell) and MUST NOT imply Claude or ACP availability. The exported contract MUST be
provider-neutral and MUST contain no Codex-specific type or entrypoint.

### Human approval of the exact package artifact and consumer candidate

An unmerged One-way orchestrator cutover candidate MAY be prepared and tested against the exact Complete unpublished public package candidate artifact before Human approval of the exact package artifact and consumer candidate. This preparation does not merge
or activate the consumer and does not mutate running or deployed consumer state. Human approval of the exact package artifact and consumer candidate is the human cross-repository approval
gate after that evidence is available and before One-way orchestrator cutover. Its approval binds:

- the exact orchestrator candidate head;
- the exact package version, source commit, packed tarball filename, and cryptographic digest;
- the approved unpublished delivery mechanism;
- the orchestrator dependency declaration and lockfile change that select that exact artifact;
- the package export/type proof consumed by the orchestrator;
- consumer mapping tests for accepted/preflight failures, terminal statuses, typed faults, events, usage, output files,
  cancellation, shutdown failure, and durable `needs_human` handling;
- the mapping and durable-gate test results produced by that exact candidate head;
- the artifact/package-pin rollback and host-rollback or host-termination procedure, without dual runtime routing.

An arbitrary local directory link, floating Git reference, unlocked file dependency, or manually substituted tarball does not
satisfy Human approval of the exact package artifact and consumer candidate.

### One-way orchestrator cutover

**Entry:** Human approval of the exact package artifact and consumer candidate is granted for the exact orchestrator head, dependency, lockfile, artifact identity, and mapping/durable-gate test
results.

One-way orchestrator cutover merges and activates that approved orchestrator head; any head, dependency, lockfile, artifact, or mapping-result
change returns to Human approval of the exact package artifact and consumer candidate. The approved candidate adds the exact dependency and lockfile entry, builds immutable AgentDefinitions
and start requests, supplies attempt-owned output directories, and maps AgentManager results into the orchestrator's durable
attempt/workflow contracts. Its mapping tests MUST prove:

1. run, step, attempt, role, model, worktree, permission, prompt, result-schema, and output-path selection stay consumer-owned;
2. technical terminal status and fault mapping preserve retry and operator evidence without inventing package policy;
3. a result requiring human action creates or resumes the durable orchestrator gate and survives process restart;
4. package cancellation does not mark a durable run cancelled unless consumer policy commits that transition;
5. unresolved manager-owned process cleanup reported through `shutdown_failed` triggers the approved host-termination path
   and forbids same-domain manager replacement only until that cleanup resolves;
6. output uncertainty quarantines only the affected invocation id/path without a global replacement ban, while active-state
   uncertainty preserves the affected id/row for consumer-backed reconciliation by a fresh manager;
7. output directory indexing and incomplete-audit recovery remain consumer responsibilities;
8. only the package path executes every provider adapter the package supports at cutover, and the consumer retains no
   legacy execution route for a provider the package already supports.

When the One-way orchestrator cutover merges and activates the approved head, it removes the legacy provider routing and the replaced process-executor and
artifact-store paths. Rollback changes the exact artifact/package pin or rolls back the host; it does not enable a dual route
or compatibility fallback. Consumer-owned reporters, durable mappings, and policy remain.

## 8. Verification expectations

Each implementation responsibility follows red-green-refactor and runs focused owning tests while iterating. Before its handoff or
merge, it runs the complete target-repository gate from [VERIFICATION.md](../VERIFICATION.md). Missing credentials or an
unsupported provider/platform cell are reported as blocked, skipped, or unsupported according to the approved matrix, never
as passed.

| Roadmap responsibility                                                     | Minimum proof before exit                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract decision research and Human approval of contract decisions        | Documentation consistency across ADRs, specification, architecture, testing, review policy, and this roadmap; recorded human approval for every Human approval of contract decisions item.                                                                                                                                               |
| Provider and platform conformance research                                 | Reproducible version/protocol/platform observations, bounded fixtures, complete supported/unsupported matrix, and completed Contract decision research and Human approval of contract decisions loop for contradictions.                                                                                                                 |
| Private agent discovery and executable probing                             | Unit/contract definition/identity/closed consumer-schema profile/registry/single-and-batch fake-probe tests, architecture positive and negative probes, and full `pnpm verify`.                                                                                                                                                          |
| Deterministic lifecycle and result conformance                             | Base shared conformance harness against deterministic fake ports, lifecycle/result contract tests, architecture proof, and full `pnpm verify`; no real-success claim.                                                                                                                                                                    |
| Real process, filesystem, security, cancellation, and shutdown conformance | Extended provider-neutral Linux/local-`ext4` harness proving exact parser reasons, authentic retained-authority races/quiescence, no raw-byte bypass, separate non-replacing raw/result publication, exact finalization/drain ordering, and absence of old compatibility paths; full `pnpm verify`; no provider or supported-cell claim. |
| Each provider adapter conformance work item                                | The same extended harness instantiated by each adapter, wire-specific tests, required Provider and platform conformance research evidence class, and full `pnpm verify` for each merged lane.                                                                                                                                            |
| Complete unpublished public package candidate                              | Complete runtime/contract/integration/package/type/declaration/export/packed-consumer/coverage/architecture evidence from one exact head and tarball, plus full `pnpm verify`.                                                                                                                                                           |
| Human approval of the exact package artifact and consumer candidate        | Exact orchestrator head, artifact identity, approved dependency and lockfile diff, successful isolated consumer install, mapping/durable-gate results, and human acceptance.                                                                                                                                                             |
| One-way orchestrator cutover                                               | Merge and activation of only the head approved by Human approval of the exact package artifact and consumer candidate, provider cutover tests, legacy-path absence proof, and the orchestrator's complete `pnpm verify`.                                                                                                                 |

No roadmap responsibility may weaken required tests, bounds, public types, or package gates to become green. The Complete unpublished public package candidate remains unpublished even
after all local verification passes.

Intermediate B+ migration heads must prove that inactive internals are unreachable from production until their atomic cutover;
verification must never accept simultaneous old/new execution calls, eager/paused I/O, normalization/completion paths, or
publication authorities.

## 9. Specification and ADR change control

During Contract decision research and Provider and platform conformance research, informative probe logs and captured provider fixtures stay separate from normative requirements. Every draft
specification change identifies the research that justifies it. The public AgentManager spec remains Draft and unimplemented until source, tests,
declarations, examples, and exports implement the complete public contract together in the Complete unpublished public package candidate.

ADR-0013 and `docs/specs/execution-handoff.spec.md` are canonical for the accepted B+ private migration. Product code remains
unimplemented. A later finding that contradicts phase order, authority ownership, parser taxonomy, ADR-0003 eligibility,
publication precedence, or migration prohibitions stops implementation and returns to a new ADR and human gate; it does not
silently reinterpret the accepted private contract.

Implementation responsibilities do not opportunistically reinterpret the draft. A provider or platform contradiction stops the
affected roadmap responsibility and returns to Contract decision research and Human approval of contract decisions. Concrete fields, schemas, error precedence, and testable behavior belong in the spec.
Hard-to-reverse changes to package/consumer ownership, public contract direction, process supervision, filesystem
publication, security posture, or supported platform policy require a new ADR and human approval. Accepted ADR decisions are
not edited in place.

## 10. Risks and controls

| Risk                                                                | Consequence                                                                                                                     | Control                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider CLI or ACP drift                                           | Parsers or permission/cancellation mappings silently stop matching real tools.                                                  | Provider and platform conformance research exact versions and fixtures; strict probes; wire-specific tests; a definition/package version change for changed behavior.                                                                                                                                                                                                                                                                       |
| A first provider shapes the core                                    | Later adapters require parallel result or lifecycle paths.                                                                      | The provider-neutral frozen real-process harness is established before the strict Native Codex, Native Claude, ACP sequence; no provider-id branches in the manager; every adapter instantiates that same suite.                                                                                                                                                                                                                            |
| Legacy unbounded buffers or queues are copied                       | Memory, audit files, or subscriber delivery can grow without limit.                                                             | Port behavior only; Human approval of contract decisions owns every collection/byte bound; Real process, filesystem, security, cancellation, and shutdown conformance proves truncation and backpressure behavior.                                                                                                                                                                                                                          |
| Cross-platform process ownership cannot be confirmed                | Shutdown can falsely report safety while a child survives.                                                                      | Provider and platform conformance research support matrix; Real process, filesystem, security, cancellation, and shutdown conformance real kill/reap tests; fail-closed `shutdown_failed`; unsupported cells are explicit.                                                                                                                                                                                                                  |
| Filesystem atomicity differs                                        | Existing evidence can be overwritten or a result can be falsely claimed durable.                                                | Provider and platform conformance research filesystem matrix; exclusive leaf and hard-link proof; late-I/O typed completion; no adoption or replacing rename.                                                                                                                                                                                                                                                                               |
| Secret redaction misses chunk boundaries                            | Credentials reach events, files, faults, or completed records.                                                                  | Human approval of contract decisions algorithm decision; Real process, filesystem, security, cancellation, and shutdown conformance split/overlap/final-carry tests before every sink.                                                                                                                                                                                                                                                      |
| A timed-out claim or preparation settles late                       | The manager releases an id/path guard while filesystem ownership is still uncertain.                                            | Preregister before dispatch; retain the identical authentic authority through bounded settlement, reconciliation, disposal, shutdown drainage, and filesystem quiescence; extend only the affected stable-ancestor warranty.                                                                                                                                                                                                                |
| Paused I/O fills operating-system pipes during setup                | The child blocks before acceptance or activation.                                                                               | Arm wall/idle/setup deadlines at spawn, keep the setup window to identity/save only, use no user-space preactivation buffer, and activate one bounded coordinator immediately after acceptance.                                                                                                                                                                                                                                             |
| Old and new private paths coexist during migration                  | Execution, completion, cleanup, or publication may happen twice under different semantics.                                      | Atomic cutover per seam; inactive internals only before cutover; architecture/contract tests prove no overload, alias, dual authority, eager/paused branch, or second completion/normalization path.                                                                                                                                                                                                                                        |
| Raw evidence or result publication authority is confused            | Ineligible provider bytes leak, committed evidence is replaced, or a false durable terminal result is claimed.                  | Output-port-only redaction destinations, ADR-0003 eligibility capability, separate non-replacing raw/result publication, exact precedence tests, and immutable process-local completion after late recording failure.                                                                                                                                                                                                                       |
| Public API is exposed incrementally                                 | Consumers bind to partial or contradictory declarations.                                                                        | Empty root until the provider-neutral shared core, filesystem layer, frozen harness, and native Codex adapter conformance are complete; one Complete unpublished public package candidate export and packed-consumer gate; the exported surface is provider-neutral and its supported provider/platform coverage is stated explicitly.                                                                                                      |
| Unpublished cross-repo consumption is not exact                     | One-way orchestrator cutover tests a different artifact from the reviewed Complete unpublished public package candidate output. | Human approval of the exact package artifact and consumer candidate version, commit, tarball digest, dependency, and lockfile acceptance.                                                                                                                                                                                                                                                                                                   |
| Human-gate policy leaks into the package                            | Process-local completion begins driving durable workflow transitions.                                                           | Provider-neutral JSON result only; One-way orchestrator cutover consumer mapping tests; durable gate creation/resume stays in orchestrator.                                                                                                                                                                                                                                                                                                 |
| Sequential merges are mistaken for completeness                     | One adapter or narrow test lane is reported as the finished AgentManager.                                                       | Roadmap responsibility status is explicit. Only the Complete unpublished public package candidate may claim a complete **public contract**, and only the ACP adapter conformance item may claim complete **provider coverage**. The two claims are never merged.                                                                                                                                                                            |
| The public contract is published with one adapter proven against it | Native Claude or ACP later needs a contract shape the published surface cannot express, forcing a breaking public change.       | The provider-neutral frozen real-process harness is complete and frozen **before** Codex; Codex instantiates it without exclusions and adds no provider-specific public type; Claude and ACP wire evidence from Provider and platform conformance research is reviewed against the candidate public surface **before** the export is approved; a later contract defect requires a new ADR and human approval, never a silent public change. |

## 11. Open human decisions ordered by roadmap responsibility

These decisions are deliberately unresolved until their owning gate. They MUST NOT be guessed by an implementation role.

| Required by                                                                                                   | Decision                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human approval of contract decisions                                                                          | Provider versions, the macOS native filesystem cell/evidence, Windows future process/filesystem design, and the remaining supported/unsupported-cell evidence for Provider and platform conformance research.                                                        |
| Human approval of contract decisions                                                                          | Required deterministic versus credentialed evidence for shared conformance.                                                                                                                                                                                          |
| Provider and platform conformance research and Private agent discovery and executable probing                 | Approval of any executable-probe or platform-unavailable observation that changes a Human approval of contract decisions decision, the draft spec, or an accepted ADR.                                                                                               |
| Provider and platform conformance research, Supported-cell closure, and All provider adapter conformance work | Full provider, process-ownership, filesystem, permission, cancellation, and supported-cell evidence before supported-cell closure and each consuming native provider adapter conformance item; not before the scoped provider-neutral Linux/local-`ext4` POSIX core. |
| Real process, filesystem, security, cancellation, and shutdown conformance                                    | Acceptance of any residual platform limitation after the approved fail-closed behavior is implemented and tested.                                                                                                                                                    |
| Human approval of the exact package artifact and consumer candidate                                           | Exact orchestrator candidate head, unpublished artifact delivery, version/commit/digest, dependency and lockfile, mapping/durable-gate results, and artifact/package-pin or host rollback procedure.                                                                 |
| One-way orchestrator cutover                                                                                  | Authorization for the one-way orchestrator cutover and removal of replaced legacy execution paths.                                                                                                                                                                   |

Until the relevant decision is approved, its roadmap responsibility is blocked rather than partially passed.
