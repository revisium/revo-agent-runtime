# AgentManager cross-repository extraction roadmap

- Status: Approved roadmap
- Implementation: Private agent discovery and executable probing is implemented and tested; the remaining lifecycle, process, provider-adapter, and public-package work remains deferred
- Target package: `@revisium/revo-agent-runtime`
- Publication: npm publication remains disabled until the Complete unpublished public package candidate is approved
- Source repository: `revo-agent-runtime`
- Consumer repository: sibling `orchestrator`

## 1. Purpose and source of truth

This roadmap sequences the extraction of one portable, process-local `AgentManager` from the sibling orchestrator into this
package. It is a delivery plan, not a public API and not a replacement for the normative
[AgentManager v1 target specification](./specs/agent-manager-v1.spec.md).

When sources disagree, follow the order in the [repository contract](../REPOSITORY.md): implemented source, tests, and the
public export map describe shipped behavior; accepted ADRs own durable architecture decisions; stable and draft specs own
their respective contract status. This roadmap may be revised when explicit research changes sequencing, but it MUST NOT make
an unimplemented target appear shipped. The root export remains empty until all provider adapter conformance work is complete.

The boundary is already decided by [ADR-0001](./adr/0001-agent-runtime-boundary.md),
[ADR-0002](./adr/0002-agent-manager-consumer-boundary.md), and
[ADR-0003](./adr/0003-invocation-output-recording.md). Research may refine the draft specification. A finding that changes an
accepted decision requires a new refining, amending, or superseding ADR and human approval before implementation continues.

## 2. Fixed decisions

The roadmap carries these approved constraints:

1. The AgentManager v1 draft is the target contract. It changes only through explicit, recorded research.
2. Roadmap responsibilities may merge sequentially, but intermediate merges do not create a public or published API.
3. The package MUST remain unpublished on npm until the Complete unpublished public package candidate is complete.
4. The root export MUST remain empty until all provider adapter conformance work is complete. The Complete unpublished public package candidate adds the complete curated public surface only after implementation,
   declarations, examples, conformance, and package proof agree.
5. AgentManager MUST NOT be called complete until native Codex, native Claude, and ACP instantiate and pass one shared
   conformance harness, in addition to their wire-specific tests.
6. Contract decision research and Human approval of contract decisions are non-waivable. Private agent discovery and executable probing additionally requires closure
   of only the Provider and platform conformance research evidence or contradiction that directly
   affects its executable-probe literals and platform-unavailable contract. Full Provider and platform conformance research
   remains non-waivable before Real process, filesystem, security, cancellation, and shutdown conformance and each provider adapter conformance work item that consumes it.
7. The root session orchestrates human gates. The package reports technical results and typed faults; it does not approve,
   persist, resume, or advance a durable human gate.
8. Cross-repository cutover is one-way. One-way orchestrator cutover does not introduce dual routing, compatibility fallbacks, or implicit provider
   selection.

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

| Package owns                                                                                                                                               | Consumer owns                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation, canonical copying, digesting, exact registry lookup, and immutable execution pins.                                                             | Durable definition storage, rollout, and exact agent, model, profile, prompt, workspace, permission, and result-schema selection.           |
| One native or ACP physical invocation, explicit child environment, bounded streams, deadlines, cancellation, process-tree termination, and confirmed reap. | Runs, tasks, steps, attempts, scheduling, durable retry, replay, workflow persistence, and restart recovery.                                |
| Provider-neutral events, usage, diagnostics, typed faults, result validation, bounded completed retention, and process-local shutdown.                     | Product verdicts, billing, routing, gates, user-facing projections, and durable indexing.                                                   |
| Exclusive recording in one exact consumer-supplied output directory, including manager-owned scratch and atomic non-replacing `result.json`.               | Output path construction, retention, crash-residue recovery, and the durable association between an attempt and its exact output directory. |
| Provider protocol, parser, and permission translation behind package-owned adapters.                                                                       | DBOS, Prisma, Nest, GraphQL, MCP, the orchestrator lifecycle CLI, Git, GitHub, worktree allocation, and deterministic system operations.    |

A technically successful JSON result MAY contain consumer-defined values such as `blocked` or `needs_human`. The package
validates and returns that object but MUST NOT interpret it as a workflow transition. During One-way orchestrator cutover, the orchestrator maps the
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

Contract decision research produces evidence-backed answers for contract gaps. It does not write production code. At minimum it must research closed
JSON Schema semantics and evaluator responsibility; RFC 8785 implementation responsibility; cancellation when a definition
declares no protocol cancellation; the acceptance/output-claim commit boundary; fault precedence; streaming redaction;
workspace/CWD and symlink policy; manager-owned concurrency and listener bounds; idle-activity semantics; and public
unsupported-platform behavior.

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
- [ ] The proposed provider-version and OS/filesystem support matrix for Provider and platform conformance research is explicit,
      including unsupported-cell behavior.
- [ ] Shared-conformance evidence is classified as deterministic real-process fixtures, credentialed live-provider runs, or a
      required combination; missing credentials are never reported as a pass.

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

| Platform/filesystem cell             | Process evidence                                                                             | Filesystem/security evidence                                                                                                          | Provider coverage                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Linux on each supported filesystem   | Direct spawn, signal/process-tree termination, confirmed reap, timeout, and cancellation.    | Owner-only scratch, exclusive leaf, bounded files, hard-link result publication, file/directory flush behavior, and cleanup ordering. | Every provider declared supported on this cell. |
| Darwin on each supported filesystem  | Direct spawn, process-group termination, confirmed reap, timeout, and cancellation.          | The same exclusive publication and owner-only evidence, including directory flush support.                                            | Every provider declared supported on this cell. |
| Windows on each supported filesystem | Direct spawn, process-tree termination mechanism, confirmed reap, timeout, and cancellation. | Equivalent owner-only scratch and non-replacing publication evidence or an approved fail-closed unsupported outcome.                  | Every provider declared supported on this cell. |

**Partial exit for Private agent discovery and executable probing:** executable-probe literals and the stable
platform-unavailable partition have no unresolved contradiction. Missing provider wire, permission, cancellation, process-ownership,
or filesystem evidence does not block this responsibility because it uses only a fake executable-probe port.

**Full exit for Real process, filesystem, security, cancellation, and shutdown conformance and the provider adapter conformance
work items:** all supported cells have reproducible observations and bounded fixtures; exact provider versions are recorded; every
unsupported cell has a stable contract; and every contradiction has completed the Contract decision research and Human approval of
contract decisions loop. Full Provider and platform conformance research is non-waivable before real-process/platform and provider
adapter conformance work even if legacy provider tests are green.

## 7. Corrected responsibility graph

```text
Contract decision research
        |
        v
Human approval of contract decisions
        |
        v
Private agent discovery and executable probing
        |
        v
Deterministic lifecycle and result conformance
        |
        v
Real process, filesystem, security, cancellation, and shutdown conformance
        |
        +--> Native Codex adapter conformance --+
        +--> Native Claude adapter conformance -+--> Complete unpublished public package candidate
        +--> ACP adapter conformance ----------+                 |
                                                               v
                         Human approval of the exact package artifact and consumer candidate
                                                               |
                                                               v
                                             One-way orchestrator cutover

Provider and platform conformance research --> Real process, filesystem, security, cancellation, and shutdown conformance
Provider and platform conformance research --> Native Codex adapter conformance
Provider and platform conformance research --> Native Claude adapter conformance
Provider and platform conformance research --> ACP adapter conformance
Contract-research contradiction -----------> Contract decision research and Human approval of contract decisions
```

The three provider adapter conformance work items may be developed in parallel after Real process, filesystem, security,
cancellation, and shutdown conformance freezes the shared harness, while merges may remain sequential. Completion of one provider
adapter conformance work item does not relax the other two.

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
remains empty; this roadmap responsibility does not make the public AgentManager available or advance the remaining lifecycle,
process, provider-adapter, and public-package work.

### Deterministic lifecycle and result conformance

**Entry:** Private agent discovery and executable probing is green.

**Owns:** an internal AgentManager composition using deterministic fake execution and file ports; dynamic
parameter/default/prompt/schema argv expansion; the accepted-to-terminal state machine; immutable request snapshots; result
parsing/object/closed consumer-schema-profile decisions behind ports; completed lookup/wait/handle identity; synchronous event ordering; and the
**base shared conformance harness** that future adapters must instantiate.

**Exit:** the fake ports prove preflight rejection versus post-acceptance typed completion, exactly one terminal transition,
the same immutable result through handle/lookup/wait/event paths, and bounded FIFO completed retention. The harness expresses
provider-neutral scenarios without branching on `codex`, `claude`, or `acp`.

Deterministic lifecycle and result conformance MUST NOT claim a real child process, secure filesystem publication, production cancellation, kill/reap, streaming
redaction, or provider success. It is an internal lifecycle/result proof only. The root export remains empty.

### Real process, filesystem, security, cancellation, and shutdown conformance

**Entry:** Deterministic lifecycle and result conformance base harness green.

**Owns:** real direct spawn and stdio ports; explicit environment capture; streaming redaction; byte, item, queue, and
retention bounds; workspace and output preflight; exclusive output leaf; owner-only scratch; bounded event/stdout/stderr/raw
files; non-replacing result publication; idle/wall deadlines; cancellation; process-tree kill/reap confirmation; shutdown;
and late-finalization failure behavior.

**Exit:** the base harness is extended with real temporary process and filesystem scenarios. It proves all approved contract-precedence and security decisions, acceptance/shutdown races, subscriber failure isolation, terminal delivery ordering, scratch cleanup,
late I/O branches, fail-closed shutdown ownership, and supported platform cells. A deterministic reference adapter passes the
extended harness. This is shared infrastructure proof, not provider completion. The root export remains empty.

### Native Codex adapter conformance

**Entry:** Real process, filesystem, security, cancellation, and shutdown conformance harness frozen and Codex provider/platform evidence approved.

**Exit:** the native Codex adapter instantiates the same extended harness without exclusions and passes Codex-specific argv,
permission, JSONL hostile/malformed/overflow, terminal selection, failure classification, usage, cancellation, and version
tests. No Codex-specific public contract is added.

### Native Claude adapter conformance

**Entry:** Real process, filesystem, security, cancellation, and shutdown conformance harness frozen and Claude provider/platform evidence approved.

**Exit:** the native Claude adapter instantiates the same extended harness without exclusions and passes Claude-specific
argv, permission/tool, stream-json hostile/malformed/overflow, terminal envelope, denial/error, usage, cancellation, and
version tests. Orchestrator role/worktree policy remains outside the adapter.

### ACP adapter conformance

**Entry:** Real process, filesystem, security, cancellation, and shutdown conformance harness frozen and ACP provider/platform evidence approved.

**Exit:** the ACP adapter uses a real invocation-scoped stdio process connector, instantiates the same extended harness without
exclusions, and passes ACP-specific framing, correlation, hostile input, permissions, cancellation/close, diagnostics,
bounds, completion barrier, and session/process isolation tests. Pooling and cross-invocation session reuse remain deferred.

### Complete unpublished public package candidate

**Entry:** Native Codex adapter conformance, Native Claude adapter conformance, and ACP adapter conformance all pass the same extended harness and their wire-specific suites.

**Owns:** the complete curated root exports, public types, declarations, consumer examples, final documentation reconciliation,
and exact packed-package proof.

**Exit:** runtime, contract, integration, architecture, type-surface, declaration, export, packed ESM/strict-TypeScript
consumer, deep-import denial, content, coverage, and full repository verification pass on the same head. The specification no
longer describes implemented behavior as unavailable. AgentManager may now be called complete, but the npm package remains
unpublished.

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
5. `shutdown_failed` triggers the approved host-termination path and forbids same-domain manager replacement;
6. output directory indexing and incomplete-audit recovery remain consumer responsibilities;
7. only the package path executes native Codex, native Claude, and ACP after cutover.

When the One-way orchestrator cutover merges and activates the approved head, it removes the legacy provider routing and the replaced process-executor and
artifact-store paths. Rollback changes the exact artifact/package pin or rolls back the host; it does not enable a dual route
or compatibility fallback. Consumer-owned reporters, durable mappings, and policy remain.

## 8. Verification expectations

Each implementation responsibility follows red-green-refactor and runs focused owning tests while iterating. Before its handoff or
merge, it runs the complete target-repository gate from [VERIFICATION.md](../VERIFICATION.md). Missing credentials or an
unsupported provider/platform cell are reported as blocked, skipped, or unsupported according to the approved matrix, never
as passed.

| Roadmap responsibility                                                     | Minimum proof before exit                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract decision research and Human approval of contract decisions        | Documentation consistency across ADRs, specification, architecture, testing, review policy, and this roadmap; recorded human approval for every Human approval of contract decisions item.                               |
| Provider and platform conformance research                                 | Reproducible version/protocol/platform observations, bounded fixtures, complete supported/unsupported matrix, and completed Contract decision research and Human approval of contract decisions loop for contradictions. |
| Private agent discovery and executable probing                             | Unit/contract definition/identity/closed consumer-schema profile/registry/single-and-batch fake-probe tests, architecture positive and negative probes, and full `pnpm verify`.                                          |
| Deterministic lifecycle and result conformance                             | Base shared conformance harness against deterministic fake ports, lifecycle/result contract tests, architecture proof, and full `pnpm verify`; no real-success claim.                                                    |
| Real process, filesystem, security, cancellation, and shutdown conformance | Extended harness against real temporary process/filesystem fixtures, security/redaction/bounds/race/finalization tests on supported cells, and full `pnpm verify`.                                                       |
| All provider adapter conformance work                                      | The same extended harness instantiated by each adapter, wire-specific tests, required Provider and platform conformance research evidence class, and full `pnpm verify` for each merged lane.                            |
| Complete unpublished public package candidate                              | Complete runtime/contract/integration/package/type/declaration/export/packed-consumer/coverage/architecture evidence from one exact head and tarball, plus full `pnpm verify`.                                           |
| Human approval of the exact package artifact and consumer candidate        | Exact orchestrator head, artifact identity, approved dependency and lockfile diff, successful isolated consumer install, mapping/durable-gate results, and human acceptance.                                             |
| One-way orchestrator cutover                                               | Merge and activation of only the head approved by Human approval of the exact package artifact and consumer candidate, provider cutover tests, legacy-path absence proof, and the orchestrator's complete `pnpm verify`. |

No roadmap responsibility may weaken required tests, bounds, public types, or package gates to become green. The Complete unpublished public package candidate remains unpublished even
after all local verification passes.

## 9. Specification and ADR change control

During Contract decision research and Provider and platform conformance research, informative probe logs and captured provider fixtures stay separate from normative requirements. Every draft
specification change identifies the research that justifies it. The spec remains Draft and unimplemented until source, tests,
declarations, examples, and exports implement the complete public contract together in the Complete unpublished public package candidate.

Implementation responsibilities do not opportunistically reinterpret the draft. A provider or platform contradiction stops the
affected roadmap responsibility and returns to Contract decision research and Human approval of contract decisions. Concrete fields, schemas, error precedence, and testable behavior belong in the spec.
Hard-to-reverse changes to package/consumer ownership, public contract direction, process supervision, filesystem
publication, security posture, or supported platform policy require a new ADR and human approval. Accepted ADR decisions are
not edited in place.

## 10. Risks and controls

| Risk                                                 | Consequence                                                                                                                     | Control                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider CLI or ACP drift                            | Parsers or permission/cancellation mappings silently stop matching real tools.                                                  | Provider and platform conformance research exact versions and fixtures; strict probes; wire-specific tests; a definition/package version change for changed behavior.                                                                                                                                                                  |
| A first provider shapes the core                     | Later adapters require parallel result or lifecycle paths.                                                                      | The shared harness is established by Deterministic lifecycle and result conformance and Real process, filesystem, security, cancellation, and shutdown conformance before all provider adapter conformance work; no provider-id branches in the manager; all three provider adapter conformance work items instantiate the same suite. |
| Legacy unbounded buffers or queues are copied        | Memory, audit files, or subscriber delivery can grow without limit.                                                             | Port behavior only; Human approval of contract decisions owns every collection/byte bound; Real process, filesystem, security, cancellation, and shutdown conformance proves truncation and backpressure behavior.                                                                                                                     |
| Cross-platform process ownership cannot be confirmed | Shutdown can falsely report safety while a child survives.                                                                      | Provider and platform conformance research support matrix; Real process, filesystem, security, cancellation, and shutdown conformance real kill/reap tests; fail-closed `shutdown_failed`; unsupported cells are explicit.                                                                                                             |
| Filesystem atomicity differs                         | Existing evidence can be overwritten or a result can be falsely claimed durable.                                                | Provider and platform conformance research filesystem matrix; exclusive leaf and hard-link proof; late-I/O typed completion; no adoption or replacing rename.                                                                                                                                                                          |
| Secret redaction misses chunk boundaries             | Credentials reach events, files, faults, or completed records.                                                                  | Human approval of contract decisions algorithm decision; Real process, filesystem, security, cancellation, and shutdown conformance split/overlap/final-carry tests before every sink.                                                                                                                                                 |
| Public API is exposed incrementally                  | Consumers bind to partial or contradictory declarations.                                                                        | Empty root until all provider adapter conformance work is complete; one Complete unpublished public package candidate export and packed-consumer gate.                                                                                                                                                                                 |
| Unpublished cross-repo consumption is not exact      | One-way orchestrator cutover tests a different artifact from the reviewed Complete unpublished public package candidate output. | Human approval of the exact package artifact and consumer candidate version, commit, tarball digest, dependency, and lockfile acceptance.                                                                                                                                                                                              |
| Human-gate policy leaks into the package             | Process-local completion begins driving durable workflow transitions.                                                           | Provider-neutral JSON result only; One-way orchestrator cutover consumer mapping tests; durable gate creation/resume stays in orchestrator.                                                                                                                                                                                            |
| Sequential merges are mistaken for completeness      | One adapter or narrow test lane is reported as the finished AgentManager.                                                       | Roadmap responsibility status is explicit; only the Complete unpublished public package candidate after all three provider adapter conformance work items may claim completeness.                                                                                                                                                      |

## 11. Open human decisions ordered by roadmap responsibility

These decisions are deliberately unresolved until their owning gate. They MUST NOT be guessed by an implementation role.

| Required by                                                                                                                                                       | Decision                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human approval of contract decisions                                                                                                                              | Acceptance of the closed consumer-schema profile and separate Zod/Ajv boundary; selection and audit of the exact-pinned external RFC 8785 implementation before Private agent discovery and executable probing. |
| Human approval of contract decisions                                                                                                                              | Observable cancellation/shutdown behavior for definitions without protocol cancellation.                                                                                                                        |
| Human approval of contract decisions                                                                                                                              | Acceptance commit, output-claim, shutdown-race, and cleanup ordering.                                                                                                                                           |
| Human approval of contract decisions                                                                                                                              | Complete fault and terminal precedence across concurrent failure sources.                                                                                                                                       |
| Human approval of contract decisions                                                                                                                              | Exact streaming redaction patterns, carry/overlap rules, and replacement semantics.                                                                                                                             |
| Human approval of contract decisions                                                                                                                              | Workspace/CWD existence, symlink, realpath, and normalization policy.                                                                                                                                           |
| Human approval of contract decisions                                                                                                                              | Package versus consumer ownership of active/probe/protocol/listener/write bounds.                                                                                                                               |
| Human approval of contract decisions                                                                                                                              | Exact idle-activity definition; legacy heartbeat/operation behavior is not automatically inherited.                                                                                                             |
| Human approval of contract decisions                                                                                                                              | Proposed provider versions, supported OS/filesystem cells, and stable unsupported behavior for Provider and platform conformance research.                                                                      |
| Human approval of contract decisions                                                                                                                              | Required deterministic versus credentialed evidence for shared conformance.                                                                                                                                     |
| Provider and platform conformance research and Private agent discovery and executable probing                                                                     | Approval of any executable-probe or platform-unavailable observation that changes a Human approval of contract decisions decision, the draft spec, or an accepted ADR.                                          |
| Provider and platform conformance research, Real process, filesystem, security, cancellation, and shutdown conformance, and All provider adapter conformance work | Full provider, process-ownership, filesystem, permission, cancellation, and supported-cell evidence before the consuming roadmap responsibility.                                                                |
| Real process, filesystem, security, cancellation, and shutdown conformance                                                                                        | Acceptance of any residual platform limitation after the approved fail-closed behavior is implemented and tested.                                                                                               |
| Human approval of the exact package artifact and consumer candidate                                                                                               | Exact orchestrator candidate head, unpublished artifact delivery, version/commit/digest, dependency and lockfile, mapping/durable-gate results, and artifact/package-pin or host rollback procedure.            |
| One-way orchestrator cutover                                                                                                                                      | Authorization for the one-way orchestrator cutover and removal of replaced legacy execution paths.                                                                                                              |

Until the relevant decision is approved, its roadmap responsibility is blocked rather than partially passed.
