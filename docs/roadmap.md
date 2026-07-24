# AgentManager cross-repository extraction roadmap

- Status: Approved roadmap
- Implementation: internal agent discovery and probing slice implemented and tested; M2–M5 deferred
- Target package: `@revisium/revo-agent-runtime`
- Publication: npm publication remains disabled through M5
- Source repository: `revo-agent-runtime`
- Consumer repository: sibling `orchestrator`

## 1. Purpose and source of truth

This roadmap sequences the extraction of one portable, process-local `AgentManager` from the sibling orchestrator into this
package. It is a delivery plan, not a public API and not a replacement for the normative
[AgentManager v1 target specification](./specs/agent-manager-v1.spec.md).

When sources disagree, follow the order in the [repository contract](../REPOSITORY.md): implemented source, tests, and the
public export map describe shipped behavior; accepted ADRs own durable architecture decisions; stable and draft specs own
their respective contract status. This roadmap may be revised when explicit research changes sequencing, but it MUST NOT make
an unimplemented target appear shipped. The root export remains empty through M4.

The boundary is already decided by [ADR-0001](./adr/0001-agent-runtime-boundary.md),
[ADR-0002](./adr/0002-agent-manager-consumer-boundary.md), and
[ADR-0003](./adr/0003-invocation-output-recording.md). Research may refine the draft specification. A finding that changes an
accepted decision requires a new refining, amending, or superseding ADR and human approval before implementation continues.

## 2. Fixed decisions

The roadmap carries these approved constraints:

1. The AgentManager v1 draft is the target contract. It changes only through explicit, recorded research.
2. Milestones may merge sequentially, but intermediate merges do not create a public or published API.
3. The package MUST remain unpublished on npm through M5.
4. The root export MUST remain empty through M4. M5 adds the complete curated public surface only after implementation,
   declarations, examples, conformance, and package proof agree.
5. AgentManager MUST NOT be called complete until native Codex, native Claude, and ACP instantiate and pass one shared
   conformance harness, in addition to their wire-specific tests.
6. R0 and G0 are non-waivable. The internal agent discovery and probing stage additionally requires closure
   of only the R1 evidence or contradiction that directly
   affects its executable-probe literals and platform-unavailable contract. Full provider and platform conformance research
   remains non-waivable before the M3 and M4 surfaces that consume it.
7. The root session orchestrates human gates. The package reports technical results and typed faults; it does not approve,
   persist, resume, or advance a durable human gate.
8. Cross-repository cutover is one-way. C1 does not introduce dual routing, compatibility fallbacks, or implicit provider
   selection.

## 3. Extraction approaches

| Approach                                          | Advantages                                                                                                                                                              | Costs and risks                                                                                                                                                | Decision                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Contract-first vertical spine                     | Establishes provider-neutral identity, lifecycle, result, security, process, and file semantics before provider specialization; makes one shared harness authoritative. | Provider execution appears later; contract and portability questions must be answered before implementation.                                                   | **Selected.** It best matches the accepted package boundary and final conformance gate. |
| Provider-led slices: Codex, then Claude, then ACP | Produces an early demonstrable provider path and can reuse parser fixtures quickly.                                                                                     | The first provider can bias the shared core; cancellation, files, faults, and events are likely to be recut for later providers.                               | Rejected because it weakens the shared-contract-first completion rule.                  |
| Move legacy subsystems, then recut them           | Preserves more legacy source and tests at the first merge.                                                                                                              | Imports ambient environment, unbounded buffering, consumer path ownership, Nest composition, product result fields, and provider-id dispatch into the package. | Rejected because temporary coupling would contradict the target architecture.           |

The selected approach grows vertically through the target dependency direction in [architecture.md](./architecture.md):
portable specification as the dependency leaf; definition and registry identity above it; execution through package-owned
ports; strategy and platform adapters behind those ports; application as the only composition layer.

## 4. Package, consumer, and durable human-gate boundary

| Package owns                                                                                                                                               | Consumer owns                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation, canonical copying, digesting, exact registry lookup, and immutable execution pins.                                                             | Durable definition storage, rollout, and exact agent, model, profile, prompt, workspace, permission, and result-schema selection.           |
| One native or ACP physical invocation, explicit child environment, bounded streams, deadlines, cancellation, process-tree termination, and confirmed reap. | Runs, tasks, steps, attempts, scheduling, durable retry, replay, workflow persistence, and restart recovery.                                |
| Provider-neutral events, usage, diagnostics, typed faults, result validation, bounded completed retention, and process-local shutdown.                     | Product verdicts, billing, routing, gates, user-facing projections, and durable indexing.                                                   |
| Exclusive recording in one exact consumer-supplied output directory, including manager-owned scratch and atomic non-replacing `result.json`.               | Output path construction, retention, crash-residue recovery, and the durable association between an attempt and its exact output directory. |
| Provider protocol, parser, and permission translation behind package-owned adapters.                                                                       | DBOS, Prisma, Nest, GraphQL, MCP, the orchestrator lifecycle CLI, Git, GitHub, worktree allocation, and deterministic system operations.    |

A technically successful JSON result MAY contain consumer-defined values such as `blocked` or `needs_human`. The package
validates and returns that object but MUST NOT interpret it as a workflow transition. During C1, the orchestrator maps the
result into its durable attempt record and, when consumer policy requires human action, creates or resumes the durable human
gate through its existing workflow boundary. Manager cancellation and shutdown do not close, approve, or bypass such a gate.

After `revo.agent.shutdown_failed`, the consumer retains the accepted host-termination obligation from ADR-0002: it escalates
host termination and does not create a replacement manager in the same supervision domain until ownership is resolved.

## 5. Legacy reuse policy and matrix

The sibling orchestrator is evidence, not the target source of truth. Port observable behavior, hostile-input partitions, and
small pure mechanics only after the target contract owns their bounds and types. Do not copy a module merely to preserve its
class, dependency injection, directory layout, or product-facing result shape. Every port starts with a target-owned failing
test and removes consumer imports.

All paths in the following table are **sibling-repository paths**, relative to this document through `../../orchestrator/`.

| Legacy source                                                                                                                                                    | Reusable evidence                                                                                                                                                                      | Required recut or exclusion                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../orchestrator/src/observability/activity-signal.ts` and adjacent test                                                                                      | Counter updates, byte accounting, snapshots, and idempotent operation-id set behavior.                                                                                                 | This is counter/idempotency evidence only. It does not establish heartbeat or operation activity as AgentManager idle-time semantics; R0 owns that decision. Exclude run-level aggregation and consumer activity types. |
| `../../orchestrator/src/acp/jsonrpc/canonicalizer.ts`, `framer.ts`, `parser.ts`, `connection.ts`, and adjacent tests                                             | JSON isolation, fragmented UTF-8 framing, frame bounds, message validation, request correlation, duplicate and unknown response handling, close behavior, and hostile-prototype tests. | Recut to package faults and limits. Bound pending requests and transport writes; the legacy write queue is not the package subscription/backpressure contract.                                                          |
| `../../orchestrator/src/acp/protocol/**`, `session/**`, and adjacent tests                                                                                       | Protocol value parsing, lifecycle ordering, capability checks, foreign-session rejection, permission requests, and close behavior.                                                     | Remove Nest decorators and host composition. Reconcile every protocol value with the R1 ACP version and provider-neutral public boundary.                                                                               |
| `../../orchestrator/src/acp/prompt-execution/prompt-outcome-collector.ts` and adjacent test                                                                      | First-terminal-wins, foreign-session rejection, duplicate-terminal rejection, usage replacement, and diagnostic partitioning.                                                          | Bound text and diagnostic accumulation, remove Nest, and map to the shared result/event contract. Do not port unbounded arrays.                                                                                         |
| `../../orchestrator/src/acp/runtime/invocation.ts`, `invocation.types.ts`, `connector.ts`, and tests                                                             | Failure latching, inbound failure racing, session isolation, permission and diagnostic flow, and completion-barrier scenarios.                                                         | The legacy runtime injects `openConnection`; `connector.ts` configures a session but does not spawn a real ACP process. M4c must add a real stdio process connector behind M3 ports.                                    |
| `../../orchestrator/src/worker/codex-runner.ts` and adjacent test                                                                                                | Codex JSONL variants, terminal candidate extraction, failure events, and usage-field extraction.                                                                                       | Separate transport parsing from `verdict`, `nextSteps`, and `needsHuman`; add target byte and item bounds; remove unbounded received/buffered stream copies and orchestrator imports.                                   |
| `../../orchestrator/src/worker/result-envelope.ts`, `claude-code-runner.ts`, and adjacent tests                                                                  | Claude stream-json terminal-result selection, transport envelope parsing, terminal metadata, and usage extraction.                                                                     | Port only provider transport behavior. Exclude role prompts, worktree policy, tool allow/deny policy, verdict schema, next-step normalization, and attempt-result mapping.                                              |
| `../../orchestrator/src/worker/process-executor.ts` and adjacent test                                                                                            | Timeout scenario partitions, stdout/stderr activity counters, detached-process experiments, and process fixture ideas.                                                                 | Do not copy the executor: it merges `process.env`, accumulates stdout/stderr without a hard bound, lacks the target cancellation contract, and does not prove authoritative cross-platform kill/reap ownership.         |
| `../../orchestrator/src/worker/artifact-store.ts` and adjacent test                                                                                              | File naming and basic redaction/tail test ideas.                                                                                                                                       | Do not copy the store: it derives run/attempt paths, recursively adopts existing directories, overwrites files, appends without file bounds, and lacks exclusive result publication.                                    |
| `../../orchestrator/src/observability/agent-activity-reporter.ts`, `src/runners/runner-manifest.ts`, `src/worker/runner-dispatch.ts`, and `src/worker/runner.ts` | Consumer-mapping scenarios for C1.                                                                                                                                                     | Keep outside the package. They own run/attempt identity, persistence delivery, provider-id dispatch, role policy, verdicts, next steps, and human-gate signals.                                                         |

## 6. Non-waivable research and decision gates

### R0 — Contract closure

**Entry:** the current draft specification, accepted ADRs, architecture, testing policy, and the legacy evidence matrix above.

R0 produces evidence-backed answers for contract gaps. It does not write production code. At minimum it must research closed
JSON Schema semantics and evaluator responsibility; RFC 8785 implementation responsibility; cancellation when a definition
declares no protocol cancellation; the acceptance/output-claim commit boundary; fault precedence; streaming redaction;
workspace/CWD and symlink policy; manager-owned concurrency and listener bounds; idle-activity semantics; and public
unsupported-platform behavior.

**Exit:** every G0 item has one explicit decision, supporting source or experiment, affected specification clauses, and an
identified verification owner. If evidence contradicts an accepted ADR, R0 returns an ADR candidate instead of silently
changing the draft.

### G0 — Human contract approval

G0 is non-waivable. The complete program requires one human-approved decision for every checkbox. Fixed decision 6 permits
the internal agent discovery and probing stage to enter after only its governing subset plus the stage-local R1
check is approved; the dated record below identifies
that subset. Every remaining checkbox must close before the later milestone that consumes it.

- [x] The supported JSON Schema draft 2020-12 surface is closed precisely, including unknown properties, `$ref`, vocabularies,
      formats, and bounded diagnostics; the evaluator and RFC 8785 dependency or package-owned implementation are approved.
- [ ] `capabilities.cancellation: false` has one observable manager-cancel and shutdown behavior.
- [ ] Acceptance is located relative to id reservation, output-leaf claim, active registration, shutdown racing, cleanup, and
      handle return; every losing path has explicit evidence ownership.
- [ ] Simultaneous cancellation, wall/idle timeout, process exit, protocol failure, result failure, scratch cleanup failure,
      and result-publication failure have a complete fault/terminal precedence rule.
- [ ] Streaming redaction defines literal and built-in patterns, replacement text, per-channel carry behavior, overlap rules,
      buffer disposal, and all pre-sink applications.
- [ ] Workspace and CWD rules define absolute normalization, existence, directory type, symlink/realpath behavior, and the
      intentionally absent workspace/output containment requirement.
- [ ] Active invocation, in-flight probe, pending protocol request, listener, and internal transport-write bounds are either
      package limits or explicitly consumer-governed with a reason.
- [ ] Idle activity defines exactly which bounded stdout, stderr, and valid protocol events reset the deadline. Legacy
      heartbeat and operation counters are not adopted without this decision.
- [ ] The proposed provider-version and OS/filesystem support matrix for R1 is explicit, including unsupported-cell behavior.
- [ ] Shared-conformance evidence is classified as deterministic real-process fixtures, credentialed live-provider runs, or a
      required combination; missing credentials are never reported as a pass.

#### Internal agent discovery and probing entry decision record — 2026-07-20

Human approval closed only the G0/R1 decisions needed to enter the internal agent discovery and probing stage;
unchecked G0 items remain mandatory before the later milestone that consumes them.

- [x] Package DTO and consumer-schema engines are `zod@4.4.3` and `ajv@8.20.0`; the closed P1 profile is
      this stage's schema surface ([ADR-0004](./adr/0004-separate-validation-engines.md)).
- [x] RFC 8785 identity uses exactly `canonicalize@3.0.0`. A project-owned audit means checked-in repeatable evidence for
      the frozen lock and installed tree, artifact integrity/license, runtime DAG/install scripts, Node/ESM/types, production
      advisories, and RFC expected/hostile vectors ([ADR-0005](./adr/0005-audited-jcs-definition-identity.md)).
- [x] Explicit probing has one manager-scoped active physical-probe bound of eight and the approved FIFO/batch-wave behavior;
      the stage verifies it only through the package port and deterministic fake.
- [x] The stage-local R1 review found no contradiction affecting internal agent discovery and probing. From the
      `revo-agent-runtime` repository root,
      `../orchestrator/src/control-plane/run-profile-contract.ts` defines `RunnerManifest` without a version-probe field and
      `../orchestrator/src/runners/runner-manifest.ts` pins only `executionFields.command`; there is no
      legacy manifest version-probe behavior for this stage to preserve. The stage therefore makes no platform-support
      claim. Real PATH,
      process, OS/filesystem, provider-version, wire, permission, cancellation, and completion evidence remains required by
      M3/M4.

The dirty or untracked state of these approved planning documents is intentional working-tree context, not an
internal agent discovery and probing stage entry blocker. The AgentManager v1 specification remains Draft, and this
decision record does not represent the stage as implemented.

No implementation milestone starts until its governing G0 decisions are approved. A later R1 contradiction returns to R0
and requires a new G0 approval for the affected decisions.

### R1 — Provider and platform conformance research

**Entry:** approved G0 decisions and an explicit proposed support matrix.

R1 records exact versions, direct-no-shell argv, delivery modes, wire fixtures, permission behavior, usage fields,
cancellation behavior, and process ownership for every provider lane:

| Lane          | Required protocol/result evidence                                                                                                                                   | Required cancellation and permission evidence                                                                                    | Required completion evidence                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Native Codex  | Exact supported `codex` version/probe, argv, JSONL frames, terminal structured-result variants, failure frames, and usage fields.                                   | Native cancellation/process-tree behavior and exact mapping of provider permission inputs to CLI arguments.                      | Captured bounded fixtures plus the approved live or deterministic evidence class; M4a later instantiates the shared harness. |
| Native Claude | Exact supported `claude` version/probe, argv, stream-json events, terminal envelope, error/denial fields, and usage fields.                                         | Native cancellation/process-tree behavior and exact permission/tool argument mapping without importing orchestrator role policy. | Captured bounded fixtures plus the approved live or deterministic evidence class; M4b later instantiates the shared harness. |
| ACP           | Exact ACP protocol version, initialization/session/prompt/close messages, framing, correlation, permission requests, usage updates, diagnostics, and hostile input. | Protocol cancellation or close behavior plus authoritative fallback process termination; session and process isolation.          | A real stdio connector design and fixtures; M4c later instantiates the shared harness.                                       |

R1 also completes the cross-product below. A cell is `required` only when G0 declares it supported; unsupported cells require a
stable preflight or construction outcome and documentation, not a skipped test disguised as success.

| Platform/filesystem cell             | Process evidence                                                                             | Filesystem/security evidence                                                                                                          | Provider coverage                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Linux on each supported filesystem   | Direct spawn, signal/process-tree termination, confirmed reap, timeout, and cancellation.    | Owner-only scratch, exclusive leaf, bounded files, hard-link result publication, file/directory flush behavior, and cleanup ordering. | Every provider declared supported on this cell. |
| Darwin on each supported filesystem  | Direct spawn, process-group termination, confirmed reap, timeout, and cancellation.          | The same exclusive publication and owner-only evidence, including directory flush support.                                            | Every provider declared supported on this cell. |
| Windows on each supported filesystem | Direct spawn, process-tree termination mechanism, confirmed reap, timeout, and cancellation. | Equivalent owner-only scratch and non-replacing publication evidence or an approved fail-closed unsupported outcome.                  | Every provider declared supported on this cell. |

**Partial exit for internal agent discovery and probing:** executable-probe literals and the stable
platform-unavailable partition have no unresolved contradiction. Missing provider wire, permission, cancellation,
process-ownership, or filesystem evidence does not block this stage because it uses only a fake executable-probe port.

**Full exit for M3/M4:** all supported cells have reproducible observations and bounded fixtures; exact provider versions are
recorded; every unsupported cell has a stable contract; and every contradiction has completed the R0/G0 loop. Full R1 is
non-waivable before the real process/platform and provider milestones even if legacy provider tests are green.

## 7. Corrected milestone graph

```text
R0 contract closure
        |
        v
G0 non-waivable human contract approval
        |                         +-------------------------+
        |                         | R1 provider/platform R&D |
        |                         | probe contradiction ----+----> R0 / G0
        v                         +-------------------------+
Internal agent discovery and probing                    |
        |                                    | full evidence before M3/M4
        v                                    |
M2 internal fake-port lifecycle/result       |
        + base shared conformance harness
        |                                    |
        v                                    |
M3 real process/files/security/supervision <-+
                    + extended shared conformance harness
                                   |
                     +-------------+-------------+
                     v             v             v
                M4a Codex     M4b Claude      M4c ACP
                     +-------------+-------------+
                                   |
                                   v
                   M5 complete unpublished public candidate
                                   |
                                   v
                   G1 exact artifact/consumer acceptance
                                   |
                                   v
                     C1 one-cutover orchestrator mapping
```

M4 lanes may be developed in parallel after M3 freezes the shared harness, while merges may remain sequential. Completion of
one M4 lane does not relax the other two.

### Internal agent discovery and probing

**Entry:** the G0 decisions that govern this stage are approved. R1 has no unresolved contradiction affecting executable-probe
literals or the platform-unavailable result partition. The dated internal agent discovery and probing entry decision
record above is the file-backed evidence for this gate. Full R1 completion is not an entry condition for this stage.

**Owns:** strict package DTO validation; the hardened P1 consumer-schema profile; complete-set all-or-nothing definition
validation; canonical package-owned copies; RFC 8785 digest; sealed exact registry; deterministic unsigned-UTF-8 listing;
explicit single and batch probes; and one bounded fair executable-probe scheduler through a fake port.

**Exit:** unit and contract tests prove P1 profile and resource rejection, bounded normalized diagnostics, duplicate and
incoherent definitions, exact lookup without latest/fallback, caller mutation isolation, deterministic digests/order,
batch prevalidation and duplicate coalescing, shared FIFO fairness and the fixed active bound of eight, strict version
parsing, bounded probe output, requested timeout termination/reap, and stable probe precedence through the fake
port. The stage checks only static definition/template/delivery/probe-literal coherence. Dynamic
parameter/default/prompt/schema argv
expansion belongs to M2. Provider permission expansion belongs to M4. Real probe process ownership and integration belong to
M3. Architecture verification proves the intended dependency direction. The root export is still empty.

**Status:** This private slice is implemented and tested. The package remains unpublished and the root export remains
empty; this milestone does not make the public AgentManager available or advance M2–M5.

### M2 — Internal fake-port lifecycle and result

**Entry:** internal agent discovery and probing is green.

**Owns:** an internal AgentManager composition using deterministic fake execution and file ports; dynamic
parameter/default/prompt/schema argv expansion; the accepted-to-terminal state machine; immutable request snapshots; result
parsing/object/P1-schema decisions behind ports; completed lookup/wait/handle identity; synchronous event ordering; and the
**base shared conformance harness** that future adapters must instantiate.

**Exit:** the fake ports prove preflight rejection versus post-acceptance typed completion, exactly one terminal transition,
the same immutable result through handle/lookup/wait/event paths, and bounded FIFO completed retention. The harness expresses
provider-neutral scenarios without branching on `codex`, `claude`, or `acp`.

M2 MUST NOT claim a real child process, secure filesystem publication, production cancellation, kill/reap, streaming
redaction, or provider success. It is an internal lifecycle/result proof only. The root export remains empty.

### M3 — Real process, files, security, cancellation, and shutdown

**Entry:** M2 base harness green.

**Owns:** real direct spawn and stdio ports; explicit environment capture; streaming redaction; byte, item, queue, and
retention bounds; workspace and output preflight; exclusive output leaf; owner-only scratch; bounded event/stdout/stderr/raw
files; non-replacing result publication; idle/wall deadlines; cancellation; process-tree kill/reap confirmation; shutdown;
and late-finalization failure behavior.

**Exit:** the base harness is extended with real temporary process and filesystem scenarios. It proves all G0 precedence and
security decisions, acceptance/shutdown races, subscriber failure isolation, terminal delivery ordering, scratch cleanup,
late I/O branches, fail-closed shutdown ownership, and supported platform cells. A deterministic reference adapter passes the
extended harness. This is shared infrastructure proof, not provider completion. The root export remains empty.

### M4a — Native Codex

**Entry:** M3 harness frozen and Codex R1 evidence approved.

**Exit:** the native Codex adapter instantiates the same extended harness without exclusions and passes Codex-specific argv,
permission, JSONL hostile/malformed/overflow, terminal selection, failure classification, usage, cancellation, and version
tests. No Codex-specific public contract is added.

### M4b — Native Claude

**Entry:** M3 harness frozen and Claude R1 evidence approved.

**Exit:** the native Claude adapter instantiates the same extended harness without exclusions and passes Claude-specific
argv, permission/tool, stream-json hostile/malformed/overflow, terminal envelope, denial/error, usage, cancellation, and
version tests. Orchestrator role/worktree policy remains outside the adapter.

### M4c — ACP

**Entry:** M3 harness frozen and ACP R1 evidence approved.

**Exit:** the ACP adapter uses a real invocation-scoped stdio process connector, instantiates the same extended harness without
exclusions, and passes ACP-specific framing, correlation, hostile input, permissions, cancellation/close, diagnostics,
bounds, completion barrier, and session/process isolation tests. Pooling and cross-invocation session reuse remain deferred.

### M5 — Complete unpublished public candidate

**Entry:** M4a, M4b, and M4c all pass the same extended harness and their wire-specific suites.

**Owns:** the complete curated root exports, public types, declarations, consumer examples, final documentation reconciliation,
and exact packed-package proof.

**Exit:** runtime, contract, integration, architecture, type-surface, declaration, export, packed ESM/strict-TypeScript
consumer, deep-import denial, content, coverage, and full repository verification pass on the same head. The specification no
longer describes implemented behavior as unavailable. AgentManager may now be called complete, but the npm package remains
unpublished.

### G1 — Exact artifact and consumer acceptance

An unmerged C1 candidate MAY be prepared and tested against the exact M5 artifact before G1. This preparation does not merge
or activate the consumer and does not mutate running or deployed consumer state. G1 is the human cross-repository approval
gate after that evidence is available and before C1. Its approval binds:

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
satisfy G1.

### C1 — One-cutover orchestrator mapping

**Entry:** G1 approved for the exact orchestrator head, dependency, lockfile, artifact identity, and mapping/durable-gate test
results.

C1 only merges and activates that approved orchestrator head; any head, dependency, lockfile, artifact, or mapping-result
change returns to G1. The approved candidate adds the exact dependency and lockfile entry, builds immutable AgentDefinitions
and start requests, supplies attempt-owned output directories, and maps AgentManager results into the orchestrator's durable
attempt/workflow contracts. Its mapping tests MUST prove:

1. run, step, attempt, role, model, worktree, permission, prompt, result-schema, and output-path selection stay consumer-owned;
2. technical terminal status and fault mapping preserve retry and operator evidence without inventing package policy;
3. a result requiring human action creates or resumes the durable orchestrator gate and survives process restart;
4. package cancellation does not mark a durable run cancelled unless consumer policy commits that transition;
5. `shutdown_failed` triggers the approved host-termination path and forbids same-domain manager replacement;
6. output directory indexing and incomplete-audit recovery remain consumer responsibilities;
7. only the package path executes native Codex, native Claude, and ACP after cutover.

When C1 merges and activates the approved head, it removes the legacy provider routing and the replaced process-executor and
artifact-store paths. Rollback changes the exact artifact/package pin or rolls back the host; it does not enable a dual route
or compatibility fallback. Consumer-owned reporters, durable mappings, and policy remain.

## 8. Verification expectations

Each implementation milestone follows red-green-refactor and runs focused owning tests while iterating. Before its handoff or
merge, it runs the complete target-repository gate from [VERIFICATION.md](../VERIFICATION.md). Missing credentials or an
unsupported provider/platform cell are reported as blocked, skipped, or unsupported according to the approved matrix, never
as passed.

| Stage                                | Minimum proof before exit                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R0/G0                                | Documentation consistency across ADRs, specification, architecture, testing, review policy, and this roadmap; recorded human approval for every G0 item.                       |
| R1                                   | Reproducible version/protocol/platform observations, bounded fixtures, complete supported/unsupported matrix, and completed R0/G0 loop for contradictions.                     |
| Internal agent discovery and probing | Unit/contract definition/identity/P1/registry/single-and-batch fake-probe tests, architecture positive and negative probes, and full `pnpm verify`.                            |
| M2                                   | Base shared conformance harness against deterministic fake ports, lifecycle/result contract tests, architecture proof, and full `pnpm verify`; no real-success claim.          |
| M3                                   | Extended harness against real temporary process/filesystem fixtures, security/redaction/bounds/race/finalization tests on supported cells, and full `pnpm verify`.             |
| M4a/M4b/M4c                          | The same extended harness instantiated by each adapter, wire-specific tests, required R1 evidence class, and full `pnpm verify` for each merged lane.                          |
| M5                                   | Complete runtime/contract/integration/package/type/declaration/export/packed-consumer/coverage/architecture evidence from one exact head and tarball, plus full `pnpm verify`. |
| G1                                   | Exact orchestrator head, artifact identity, approved dependency and lockfile diff, successful isolated consumer install, mapping/durable-gate results, and human acceptance.   |
| C1                                   | Merge and activation of only the G1-approved head, provider cutover tests, legacy-path absence proof, and the orchestrator's complete `pnpm verify`.                           |

No milestone may weaken required tests, bounds, public types, or package gates to become green. M5 remains unpublished even
after all local verification passes.

## 9. Specification and ADR change control

During R0 and R1, informative probe logs and captured provider fixtures stay separate from normative requirements. Every draft
specification change identifies the research that justifies it. The spec remains Draft and unimplemented until source, tests,
declarations, examples, and exports implement the complete public contract together at M5.

Implementation milestones do not opportunistically reinterpret the draft. A provider or platform contradiction stops the
affected milestone and returns to R0/G0. Concrete fields, schemas, error precedence, and testable behavior belong in the spec.
Hard-to-reverse changes to package/consumer ownership, public contract direction, process supervision, filesystem
publication, security posture, or supported platform policy require a new ADR and human approval. Accepted ADR decisions are
not edited in place.

## 10. Risks and controls

| Risk                                                 | Consequence                                                                      | Control                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Provider CLI or ACP drift                            | Parsers or permission/cancellation mappings silently stop matching real tools.   | R1 exact versions and fixtures; strict probes; wire-specific tests; a definition/package version change for changed behavior. |
| A first provider shapes the core                     | Later adapters require parallel result or lifecycle paths.                       | M2/M3 shared harness before M4; no provider-id branches in the manager; all M4 lanes instantiate the same suite.              |
| Legacy unbounded buffers or queues are copied        | Memory, audit files, or subscriber delivery can grow without limit.              | Port behavior only; G0 owns every collection/byte bound; M3 proves truncation and backpressure behavior.                      |
| Cross-platform process ownership cannot be confirmed | Shutdown can falsely report safety while a child survives.                       | R1 support matrix; M3 real kill/reap tests; fail-closed `shutdown_failed`; unsupported cells are explicit.                    |
| Filesystem atomicity differs                         | Existing evidence can be overwritten or a result can be falsely claimed durable. | R1 filesystem matrix; exclusive leaf and hard-link proof; late-I/O typed completion; no adoption or replacing rename.         |
| Secret redaction misses chunk boundaries             | Credentials reach events, files, faults, or completed records.                   | G0 algorithm decision; M3 split/overlap/final-carry tests before every sink.                                                  |
| Public API is exposed incrementally                  | Consumers bind to partial or contradictory declarations.                         | Empty root through M4; one complete M5 export and packed-consumer gate.                                                       |
| Unpublished cross-repo consumption is not exact      | C1 tests a different artifact from the reviewed M5 output.                       | G1 version, commit, tarball digest, dependency, and lockfile acceptance.                                                      |
| Human-gate policy leaks into the package             | Process-local completion begins driving durable workflow transitions.            | Provider-neutral JSON result only; C1 consumer mapping tests; durable gate creation/resume stays in orchestrator.             |
| Sequential merges are mistaken for completeness      | One adapter or narrow test lane is reported as the finished AgentManager.        | Milestone status is explicit; only M5 after all M4 lanes may claim completeness.                                              |

## 11. Open human decisions ordered by milestone

These decisions are deliberately unresolved until their owning gate. They MUST NOT be guessed by an implementation role.

| Required by                               | Decision                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0                                        | Acceptance of the closed P1 schema profile and separate Zod/Ajv boundary; selection and audit of the exact-pinned external RFC 8785 implementation before implementation of the internal agent discovery and probing stage. |
| G0                                        | Observable cancellation/shutdown behavior for definitions without protocol cancellation.                                                                                                                                    |
| G0                                        | Acceptance commit, output-claim, shutdown-race, and cleanup ordering.                                                                                                                                                       |
| G0                                        | Complete fault and terminal precedence across concurrent failure sources.                                                                                                                                                   |
| G0                                        | Exact streaming redaction patterns, carry/overlap rules, and replacement semantics.                                                                                                                                         |
| G0                                        | Workspace/CWD existence, symlink, realpath, and normalization policy.                                                                                                                                                       |
| G0                                        | Package versus consumer ownership of active/probe/protocol/listener/write bounds.                                                                                                                                           |
| G0                                        | Exact idle-activity definition; legacy heartbeat/operation behavior is not automatically inherited.                                                                                                                         |
| G0                                        | Proposed provider versions, supported OS/filesystem cells, and stable unsupported behavior for R1.                                                                                                                          |
| G0                                        | Required deterministic versus credentialed evidence for shared conformance.                                                                                                                                                 |
| R1 / internal agent discovery and probing | Approval of any executable-probe or platform-unavailable observation that changes a G0 decision, the draft spec, or an accepted ADR.                                                                                        |
| R1/M3-M4                                  | Full provider, process-ownership, filesystem, permission, cancellation, and supported-cell evidence before the consuming milestone.                                                                                         |
| M3                                        | Acceptance of any residual platform limitation after the approved fail-closed behavior is implemented and tested.                                                                                                           |
| G1                                        | Exact orchestrator candidate head, unpublished artifact delivery, version/commit/digest, dependency and lockfile, mapping/durable-gate results, and artifact/package-pin or host rollback procedure.                        |
| C1                                        | Authorization for the one-way orchestrator cutover and removal of replaced legacy execution paths.                                                                                                                          |

Until the relevant decision is approved, its milestone is blocked rather than partially passed.
