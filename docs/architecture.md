# Architecture

## Purpose and status

`@revisium/revo-agent-runtime` will expose one process-local `AgentManager` for exact, versioned AI-agent invocations. Native
Codex, native Claude, and ACP will share one registry-access, executable-probing, process, observability, cancellation,
shutdown/reaping, JSON-result, output-file, and local active-process reconciliation boundary without taking ownership of
consumer orchestration or durable workflow state.

Private agent discovery and executable probing, plus private deterministic lifecycle/result conformance through fake
execution and file ports, are implemented and tested. The npm package remains unpublished and the root package export remains
empty. The complete public AgentManager and real process/filesystem/security/cancellation/shutdown, provider-adapter, and
public-package work remain target or deferred. The normative public target is [the AgentManager v1 specification](./specs/agent-manager-v1.spec.md).
The accepted package-private execution target is [ADR-0013](./adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md)
and the [B+ execution-handoff specification](./specs/execution-handoff.spec.md); it is not implemented.

## Consumer flow

1. The consumer loads all immutable versioned agent definitions and constructs one manager with an active-state sink.
2. Construction validates plain JSON definitions, canonical-serializes and SHA-256 digests them, parses package-owned
   copies, drops caller references, and seals the registry.
3. The consumer loads its selected active rows and calls one-shot asynchronous `initialize()`. The manager validates the
   complete list, then safely terminates identity-matched non-reconnectable local processes, removes definitely absent rows,
   and fails closed after preserving/reporting unknown pins, identity conflicts, or uncertain rows.
4. After successful initialization, the consumer reads exact agents from the sealed registry, may run an executable probe,
   and may subscribe to future events.
5. The consumer starts an exact `{ id, version }` with an opaque invocation id, dynamic inputs, a JSON Schema result
   contract, and one exact output directory.
6. The manager snapshots inputs, reads the sealed registry exactly once, and seals every resource-independent decision before
   output mutation. It preregisters output claim before exclusive-create dispatch and preregisters output-preparation
   authority before the first postclaim mutation.
7. The manager binds attested claimed resources into one authentic one-use prepared execution and preregisters process-start
   ownership before native spawn. Spawn acceptance captures authentic live authority, arms wall/idle/setup deadlines, and
   leaves process I/O paused.
8. One active-state setup window covers only identity inspection, fingerprint capture, and fulfillment of the initial
   `running` save. The manager then atomically accepts and creates the handle, registers one duplex coordinator, and activates
   I/O exactly once.
9. One coordinator consumes independently redacted stdout, stderr, and protocol bytes, preserves exact parser reasons, and
   arbitrates the first successful terminal commit. Leader exit or cancellation reaches a terminal commit only after
   confirmed group cleanup; uncertainty retains the authentic cleanup owner and remains nonterminal.
10. Finalization removes active state, normalizes without reparsing, cleans scratch, flushes bounded evidence, publishes an
    eligible ADR-0003 raw response and `result.json` separately without replacement, commits the process-local result, then
    best-effort records and delivers the terminal lifecycle event.
11. Shutdown closes new work and concurrently drains preregistered claim, preparation, start, paused-I/O, accepted, probe,
    active-state, publication, and retained-authority owners under their operation-owned bounds. Unresolved process cleanup
    prohibits same-domain replacement; output and active-state uncertainty retain only their affected id/path/row obligations.
12. The consumer decides replacement in a safe domain, active-row selection, retry, workflow, gate, indexing, retention, and
    recovery policy. None of this target sequence is a shipped support claim.

## Target production structure

The first implementation should grow vertically inside this structure. The accepted
[internal module structure specification](./specs/internal-module-structure.spec.md) owns the exact PR #4 leaves, barrels,
and import form. This broader target does not require empty placeholder directories or files.

```text
src/
├── application/
│   ├── create-agent-manager.ts
│   └── manager/
│       ├── agent-manager.ts
│       ├── active-invocation-state.ts
│       ├── completed-invocations.ts
│       ├── initialization.ts
│       ├── subscriptions.ts
│       └── shutdown.ts
├── runtime/
│   ├── spec/
│   │   ├── json/
│   │   ├── agent-definition/
│   │   ├── agent-fault/
│   │   ├── agent-probe/
│   │   ├── manager-options/
│   │   ├── agent-event/              # later target
│   │   ├── agent-invocation/         # later target
│   │   ├── agent-result/             # later target
│   │   └── index.ts
│   ├── policy/
│   │   ├── limits/
│   │   ├── fault-messages.ts
│   │   └── index.ts
│   ├── errors/
│   │   ├── agent-manager-error.ts
│   │   └── index.ts
│   ├── definition/
│   │   ├── agent-definition-schema/
│   │   ├── consumer-schema-profile/
│   │   ├── consumer-schema-validator/
│   │   ├── definition-digest/
│   │   ├── executable-version-constraint/
│   │   ├── plain-json/
│   │   ├── rfc8785/
│   │   ├── strict-semver/
│   │   ├── validate-definition/
│   │   ├── validation-diagnostics/
│   │   └── index.ts
│   ├── registry/
│   │   ├── sealed-agent-registry.ts
│   │   └── index.ts
│   ├── probe/
│   │   ├── executable-probe-port/
│   │   ├── version-output/
│   │   └── index.ts
│   └── execution/
│       ├── preparation and authentic carriers
│       ├── output claim and publication ports
│       ├── process start and one-use activation ports
│       ├── duplex coordination
│       ├── parser observation and normalization
│       └── retained claim, cleanup, and quiescence authority
├── strategies/
│   ├── protocol/
│   │   ├── native/
│   │   └── acp/
│   ├── result-parser/
│   │   ├── codex/
│   │   └── claude/
│   └── permissions/
│       ├── codex/
│       ├── claude/
│       └── acp/
├── platform/
│   ├── process/
│   │   ├── environment.ts
│   │   ├── process-fingerprint.ts
│   │   └── process-inspector.ts
│   └── filesystem/
│       └── invocation-files.ts
├── testing/                  # only after a real published consumer need
└── index.ts
```

## File and area responsibilities

| Area                       | Owns                                                                                                                                                                          | Must not own                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `runtime/spec`             | Provider-neutral JSON-compatible type-only contracts behind domain and layer barrels.                                                                                         | Runtime values, Node APIs, behavior, side effects, or test code.                                           |
| `runtime/policy`           | Immutable limits, defaults, and stable message values.                                                                                                                        | Specification, errors, definition behavior, or composition.                                                |
| `runtime/errors`           | Typed runtime errors that depend only on specification types.                                                                                                                 | Policy, definition behavior, process, or composition.                                                      |
| `runtime/definition`       | Plain-JSON inspection, closed definition validation, canonicalization, and digest.                                                                                            | Mutable registration, execution, process or filesystem access.                                             |
| `runtime/registry`         | Exact `{ id, version }` lookup over one sealed immutable definition set.                                                                                                      | Latest/fallback resolution, mutation after construction, execution.                                        |
| `runtime/probe`            | Provider-neutral executable-probe ports and deterministic version-output interpretation.                                                                                      | Concrete process mechanics, manager composition, agent selection, or scheduling.                           |
| `runtime/execution`        | Sealed preparation, authentic one-use carriers, execution-owned ports, resource finalization, duplex coordination, exact observations, normalization, and deadline contracts. | Consumer workflow concepts, concrete Node or provider mechanics.                                           |
| `strategies/protocol`      | Native stdio and ACP framing behind execution-owned protocol ports.                                                                                                           | Manager composition, durable workflow state, direct file policy.                                           |
| `strategies/result-parser` | Bounded provider-specific extraction with the exact execution-owned parser taxonomy.                                                                                          | Product verdicts or consumer JSON Schema selection.                                                        |
| `strategies/permissions`   | Translation of provider-neutral validated permission data into one provider invocation.                                                                                       | Authorization policy or approval workflow decisions.                                                       |
| `platform/process`         | Explicit environment, strict SemVer probe, group spawn with paused I/O, normal live signal/reap mechanics, and OS identity inspection.                                        | Agent selection, credential policy, result semantics, or recovery authority from persisted identity alone. |
| `platform/filesystem`      | Exclusive claim/preparation mechanics, output-port-owned raw destinations, separate non-replacing publication, cleanup, and quiescence.                                       | Path construction, indexing, retention, restart recovery, or parser semantics.                             |
| `application`              | Sole cross-boundary composition root, preregistered drain ownership, authentic authority transfer, active-state ordering, records, subscriptions, and shutdown.               | Provider branches by agent id, database reads, distributed coordination, scheduling, retries.              |
| `testing`                  | Deliberately published fakes or conformance harnesses after demonstrated consumer demand.                                                                                     | Repository-only fixtures or a second production API.                                                       |
| root `index.ts`            | Curated public exports implemented and proven together.                                                                                                                       | Deep implementation barrels or accidental testing exports.                                                 |

Tests mirror behavior rather than production folders:

```text
test/
├── unit/          # current private definition, registry, probe, lifecycle, and tooling behavior
├── contract/      # current private deterministic lifecycle/result conformance; future public-runtime contract
├── integration/   # introduced only with process/filesystem/consumer behavior
├── package/       # current empty root entrypoint and metadata proof
└── support/       # current narrow definition/probe fakes and lifecycle-conformance support
```

## Dependency direction

`runtime/spec` and `runtime/policy` are independent leaves. Errors type-import from specification only. Definition behavior
may depend on specification types, policy values, and errors. Registry builds immutable identity from definition and
specification. Probe owns provider-neutral executable-probe ports and uses definition parsing for strict version
interpretation. Execution is a parallel building block over portable contracts and its own ports. Registry, probe, and
execution do not import each other. Strategies and platform adapters implement execution ports without depending on each
other. Application is the sole composition root and wires registry, probe, execution, strategies, and platform together. It
also owns preregistration and transfer between pending and accepted drain owners. Execution never rereads the registry, and
an adapter never selects a provider or branches on an agent id.

```text
importer -> dependency

runtime/errors -> runtime/spec (type-only)
runtime/definition -> runtime/spec
runtime/definition -> runtime/policy
runtime/definition -> runtime/errors

runtime/registry -> runtime/spec
runtime/registry -> runtime/definition
runtime/probe -> runtime/spec
runtime/probe -> runtime/policy
runtime/probe -> runtime/errors
runtime/probe -> runtime/definition
runtime/execution -> runtime/spec

strategies -> runtime/execution (implements execution ports)
platform -> runtime/execution (implements execution ports)

application -> runtime/registry
application -> runtime/probe
application -> runtime/execution
application -> strategies
application -> platform
```

Forbidden directions include:

- `runtime/spec` or `runtime/policy` to any other production area;
- `runtime/errors` to policy, definition, registry, execution, strategies, platform, or application code;
- definition to probe, registry, execution, strategy, platform, application, or testing code;
- probe to registry, execution, strategy, platform, application, or testing code;
- execution to concrete strategies, platform, application, or testing code;
- strategy or platform adapters to application or testing code;
- production code to repository scripts, tests, generated output, or consumer applications;
- consumer integration tests to private source modules once that lane exists.

The committed architecture verification runs the positive graph and synthesizes representative forbidden-import and cycle
probes. A green empty graph alone is not accepted as evidence that the rules work.

## AgentManager boundary

The manager owns a sealed definition registry and one process-local supervision domain. It may initialize from one
consumer-supplied active snapshot set, list and probe agents, subscribe to lifecycle events from all or one invocation,
start and cancel work, list active and retained completed invocations, return the same terminal result through handle,
lookup, and wait paths, and shut down every process it owns. One manager may supervise multiple invocations; each accepted
invocation owns one root process tree through private `ProcessManager` and `ManagedProcess` mechanics.

The complete method set is summarized here only by responsibility; the
[AgentManager v1 specification](./specs/agent-manager-v1.spec.md) owns signatures and behavior.

| Responsibility               | API surface                                                      |
| ---------------------------- | ---------------------------------------------------------------- |
| Composition and faults       | `createAgentManager`, `AgentManagerError`                        |
| Local recovery barrier       | `initialize` with consumer-loaded active snapshots               |
| Pure sealed-registry reads   | `listAgents`, `getAgent`                                         |
| Process-creating probe       | `probeAgent`                                                     |
| Future lifecycle observation | `subscribe` plus returned `Unsubscribe`                          |
| Invocation acceptance        | `start` -> `AgentInvocationHandle`                               |
| Process-local state reads    | `listInvocations`, `getInvocation`, `getResult`, `waitForResult` |
| Handle synchronization       | handle `result`                                                  |
| Cancellation                 | handle `cancel`, manager `cancel`                                |
| Process-local shutdown       | manager `shutdown`                                               |
| Handle identity              | `invocationId`, immutable execution `pin`                        |

Construction accepts an `ActiveInvocationStateSink` with `save` and `remove` only. The consumer loads active rows and passes
them to `initialize()`; the manager never queries a database. Initialization is one-shot and concurrency-safe. Before it
settles successfully, process-creating and observation operations are closed. The consumer owns integrity, provenance, and
selection of rows for this local manager. Duplicate or malformed snapshots fail before reconciliation; unknown/mismatched
pins and process identity conflicts are preserved as row failures while valid rows continue. Inspection, termination, or sink
uncertainty fails initialization closed after all independent work. Operation and total initialization deadlines bound every
path; retry requires a new manager and newly loaded rows. Pure sealed-registry reads and shutdown remain available.

The retained-completed registry is a deterministic FIFO with an exact construction range of 1 through 1,000 records and a
default of 1,000. The consumer may select a lower value at construction. Active invocations never occupy this capacity and are
never evicted. Completed-record eviction makes an invocation unknown to the manager and does not touch consumer files. The
consumer owns durable indexing and may retain output-directory coordinates in its own attempt record.

V1 has no package-owned active-invocation admission limit and no internal admission queue. The consumer owns admission,
concurrency limits, scheduling, and overload policy before `start()`. Bounded recovery input and bounded executable-probe
concurrency are separate safeguards, not active-invocation admission limits.

Shutdown is the manager's concurrency-safe, idempotent process-local lifecycle boundary. Closing rejects new starts, probes,
and subscriptions and concurrently drains preregistered claim/preparation/start attempts, paused-I/O starts, accepted work,
probes, active-state lanes, publication owners, and retained claim/cleanup authorities. Each registration boundary arbitrates
with close before dispatch; no claimed or spawned work can occupy an unregistered interval. Successful closing requires
confirmed process absence/reap, accepted terminal completion, and output quiescence before listeners clear. It does not
independently clear completed records or remove consumer output directories.

Shutdown before initialization closes an empty manager. Shutdown during initialization closes new work, aborts the current
abortable recovery operation, starts no more rows, and uses only that initialization's existing remaining deadline while
still requiring confirmation for every process already signalled. `initializationTimeoutMs` is not a general close deadline;
all other operations retain their own bounds.

The first shutdown owns one shared settlement. Unresolved process cleanup rejects it with non-retryable
`revo.agent.shutdown_failed`, leaves an accepted invocation active and nonterminal, and prohibits same-domain replacement
until cleanup is externally resolved. Output uncertainty quarantines only the affected id/path and extends its stable-ancestor
warranty; active-state uncertainty preserves the affected id/row for fresh-manager consumer reconciliation. Neither imposes
the process-cleanup replacement ban after process absence/reap is confirmed.

This lifecycle ownership does not make the package a workflow engine. The consumer still decides when to replace a closed
manager in a safe domain, which active rows belong to it, how to resolve distributed races, when to retry or reschedule work,
and how to reconcile durable workflow and result state.

Manager construction and invocation acceptance defensively copy JSON through canonical serialization and parse. Execution
retains no caller-owned definition, metadata, parameter, permission, result-schema, limit, or environment container. The
ephemeral start context explicitly allowlists inherited environment names and separates non-secret variables from secret
credentials. No child receives wholesale `process.env`; secret values join streaming redaction before spawn and are
discarded after finalization. Inherited and variable values are deliberately non-confidential and cannot use credential-like
names.

Every deterministic request, definition, binding, schema, permission, environment, workspace, platform, bound, and fresh
executable-proof decision completes before output mutation. The manager reads the sealed registry once, launches the resolved
absolute executable without a shell or reinterpretation, and never grants authority to persisted identity data.

Claim, output preparation, and process start are each registered in shutdown drainage before dispatch. Claim timeout retains
the identical claim guard; preparation uncertainty retains the identical publication and cleanup authority. Attested claimed
resources bind into one authentic one-use prepared execution. Spawn acceptance captures authentic live authority, arms
wall/idle/setup deadlines, and keeps stdout and stderr unpumped. The one setup deadline covers only identity inspection,
fingerprint capture, and fulfillment of the initial `running` save.

Acceptance and handle creation are atomic and occur after identity/save success while I/O remains paused. Sole-coordinator
registration and one-use I/O activation occur afterward and cannot retroactively reject `start()`. No claim, preparation,
start attempt, paused process, or rejected cleanup guard is a public invocation before acceptance. Every preacceptance
rejection either confirms process cleanup and any required active-row reconciliation or retains the authentic owner and id
reservation for shutdown/fresh-manager reconciliation. A postacceptance activation failure enters the accepted terminal
arbiter rather than reverting to rejection.

Definitions are data; protocol drivers, result parsers, permission translators, process execution, and filesystem behavior
are package code. Adding an agent that uses existing strategies requires a new versioned definition, not an agent-id branch
in manager or consumer code. Adding genuinely new protocol or parsing behavior requires a package change and conformance
proof.

## Active-process recovery boundary

`ActiveInvocationSnapshot` is a minimal operational row, not a result or history record. It contains `invocationId`, the
exact `AgentExecutionPin`, `running | cancelling`, and `{ pid, processGroupId, fingerprint, startedAt }`. `startedAt` is an
application timestamp for observability only. The output directory is not duplicated because the consumer already owns its
durable coordinate and it is not needed for process identity comparison. The row contains no prompt, environment,
credentials, result, terminal status, or consumer workflow fields.

The first active-state recovery implementation and evidence cell is Linux on a local `ext4` filesystem. Invocation processes
start in a separate process group with I/O paused. One active-state setup deadline covers immediate identity inspection,
fingerprint capture, and fulfillment of the initial `running` save; coordinator registration and activation occur only after
acceptance and outside that deadline. Identity inspection creates opaque
`sha256:<lowercase hex>` over
canonical, versioned, package-owned OS identity fields: process creation identity/time, resolved executable identity/path,
PID/process group, and local boot/session discriminator when supplied. It never fingerprints argv, environment, prompt,
credentials, or caller data. Invocation wall-clock time starts at successful spawn. Capture/save occurs before acceptance:
after confirmed live-owned cleanup, its timeout rejects `start()` with no public lifecycle record. A rejected/timed save is
maybe-persisted, so its per-invocation serialized active-state lane waits for a still-unsettled save to fulfil after abort
within the bounded quiescence window; only then does it call absent-row-safe idempotent removal, whose fulfilment is also
required before guard release. A rejected save leaves quiescence unknown and receives no removal. Unknown quiescence or
unknown/rejected removal retains the reconciliation guard/reservation and fails the manager closed for fresh-manager consumer
reconciliation. An unconfirmed identity reap keeps primary
`process_identity_failed`; an initial-save failure without cancellation keeps primary `active_state_failed`; each adds bounded
cleanup-uncertain detail, private guard, and id reservation without becoming a false terminal result. macOS requires a later
separate native implementation and evidence cell; Linux evidence does not establish macOS support. Windows is unsupported and
outside the MVP pending a separately approved process/filesystem design and native evidence.

The consumer-supplied row list is trusted selection/provenance input. The package does not prove ownership. Recovery cleanup
authority exists only after a fresh package observation's recomputed fingerprint exactly matches the saved fingerprint; this
is independent of normal in-memory supervision, which signals only through the authentic private live capability, its
coordinator owner, or its retained cleanup owner. An unknown/mismatched pin or live fingerprint mismatch is
preserved and reported, because mismatch may represent PID reuse, executable replacement, or corrupted state. Only a
definitely absent PID is removed. A live identity match receives group `SIGTERM`, a bounded wait, group `SIGKILL` when
needed, and confirmed termination before removal. Persisted PID/PGID values alone are never authority to signal.

The runtime fulfills the initial `running` save before atomic acceptance/handle creation, then registers the sole coordinator
and activates I/O exactly once. It starts the `cancelling` save best-effort without awaiting it, its timeout, or eventual
quiescence before provider dispatch or the first cancellation signal. Cancellation before spawn
makes no sink call or signal and rejects the pending `start()`. Cancellation after spawn
but before initial-save dispatch writes no row and, after confirmed cleanup, rejects with its bounded cancellation cause.
After dispatch, `running` is maybe-persisted even when save rejects or times out: confirmed reap attempts absent-row-safe
idempotent removal only after a still-unsettled save fulfils after abort in the bounded quiescence window. A rejected save
leaves quiescence unknown and receives no removal. A fulfilled removal is required before the id can release or be reused.
Unknown quiescence or unknown/rejected removal retains the reconciliation guard/reservation and fails the manager closed for a
fresh manager's consumer-backed reconciliation. Unconfirmed cancellation reap rejects with primary `process_cleanup_failed`,
retains the owned-child guard/reservation, and is retried during shutdown.
None of these pre-acceptance paths creates events, a result, completed retention, or a visible lookup. A `cancelling` save
failure after acceptance is surfaced through bounded diagnostics but cannot delay or prevent live kill/reap. After confirmed
termination, removal is attempted; a stale `running` row is safely removed on the next
initialization when its PID is absent. Snapshot state describes persisted process supervision and is distinct from
`AgentInvocationStatus`.

Native Codex, native Claude, and ACP over stdio are non-reconnectable in v1. Initialization cleans them up; it does not
rehydrate an invocation handle, result waiter, event stream, or stdio session. Reconnectable ACP over a durable socket/daemon
is deferred. If the recorded group leader is already gone while descendants might remain, identity cannot be verified from
the stale group id; the runtime does not signal the group or claim descendant cleanup.

When a normally observed leader exits, the manager first sweeps and terminates descendants using its authentic live or
transferred coordinator authority. It
removes active state and finalizes only after confirming the group is gone. Unconfirmed cleanup preserves the row, emits
typed `process_cleanup_failed`, and keeps the invocation nonterminal; continued shutdown uncertainty becomes
`shutdown_failed`. One bounded `remove` failure after confirmed cleanup leaves only a stale row and cannot change the result.
The active row has no terminal or pending-ack state.

This accepted unreaped path is distinct from Option A/U1/C1/S1. After a handle exists, unreaped cleanup leaves a public active
invocation nonterminal and never changes the completed `start()` call into a rejection. The private rejected-start guards used
before acceptance remain invisible to public invocation/result APIs.

## Output and observability boundary

The consumer authorizes `workspace.directory`. Preflight bounds and normalizes it, requires an absolute existing directory,
and then uses it as the invocation working directory. The package does not certify workspace realpath or symlink topology,
containment, ownership, provenance, or hostile-rebinding safety. It neither requires nor implies containment between workspace
and output directories. Invalid workspace input fails with `revo.agent.workspace_invalid` before output-leaf claim or
invocation spawn.

The consumer supplies the exact invocation directory whose leaf must not exist, provisions its existing parent hierarchy,
and warrants trusted stable ancestors until terminal filesystem quiescence. The manager preregisters an authentic claim owner
before exclusive absent-leaf creation and preregisters output-preparation publication/cleanup authority before the first
postclaim mutation. It creates no ancestors and never adopts `EEXIST`. Claim or preparation uncertainty retains the identical
authority and quarantines the affected invocation id/path.

The output port alone constructs the three independent stdout, stderr, and protocol redaction fronts and their bounded raw
destinations. Protocol preparation creates one authentic deferred destination that buffers zero bytes before its exact
one-use bind. The port owns `.scratch`, `events.ndjson`, `stdout.log`, `stderr.log`, eligible failure-only
`raw-final-response.txt`, and `result.json`. Eligible raw evidence and the terminal result publish separately without
replacement. The manager never derives consumer hierarchy, replaces or deletes committed evidence, chooses retention, or
lets raw child bytes bypass redaction. Controlled completion deletes only manager-owned scratch and temporary paths.

Terminal filesystem quiescence requires every package file operation for the start to have settled, including recording,
publication, flush, scratch/temp cleanup attempts, and the terminal filesystem append. Process exit alone is insufficient;
reported filesystem uncertainty extends the warranty until consumer reconciliation. V1 makes no hostile-ancestor safety
claim from normalization, realpath, or containment checks. Trusted symlink and mount topology are consumer-certified;
hostile-output-ancestor support and later supported filesystem cells remain separate gates.

A leaf claimed by rejected pre-acceptance setup is consumer-owned quarantined residue. The manager removes only its scratch
and temp paths, never deletes that leaf, and another start with the same path fails `output_conflict`. Consumer retention
eventually removes it; retry uses a fresh output path.

Events, stream data, result diagnostics, and files are bounded and redacted before leaving their owning boundary. Public
events and `events.ndjson` are lifecycle-only: `invocation.finished` signals result availability, while streams, diagnostics,
files, and results remain in the bounded file and result contracts. The event recorder reserves a relationally valid terminal
event tail. Late I/O failure may leave `result.json` absent or omit the terminal NDJSON line; those are incomplete audit
records. The live manager still commits one completed record and delivers exactly one process-local `invocation.finished`.
Listeners execute synchronously and the package creates no listener queue, worker pool, or numeric fanout limit. Listener
failures are isolated from execution. The consumer owns listener execution cost, downstream buffering, batching, parallel
fanout, and backpressure; a slow listener may therefore add consumer-side latency.

## ACP boundary

ACP is a private adapter to the same invocation contract as native command-line runners. Third-party SDK types do not cross
the public package boundary. An official ACP SDK may replace package-owned framing only after conformance tests prove parity
for correlation, hostile input, permissions, cancellation, diagnostics, bounds, and process/session isolation.

The initial lifecycle is invocation-scoped: one physical invocation owns one process, at most one ACP-over-stdio session,
and one top-level prompt. Pooling, cross-invocation session resume, and reconnectable socket/daemon ACP are deferred.

## Consumer-owned responsibilities

The package does not own:

- definition storage or rollout;
- choosing an agent version, model, workspace, prompt, or result schema;
- Revo runs, steps, attempts, pipelines, gates, scheduling, or retry policy;
- active-invocation admission, concurrency limits, overload policy, or an invocation-admission queue;
- listener execution cost, downstream buffering, batching, parallel fanout, or backpressure;
- workspace authorization beyond bounded normalized absolute existing-directory validation, including realpath/symlink,
  containment, ownership, provenance, or hostile-rebinding certification;
- active-row database/repository reads, row selection, distributed races, locks, leases, or claims;
- DBOS coordination, output-hierarchy provisioning and stable-ancestor warranty, path construction, durable result/history
  indexing, file retention, recovery policy, or user-facing log projections;
- Git, GitHub, or other deterministic system operations;
- credentials policy, billing policy, or product verdict interpretation.

## Quality attributes

- **Determinism:** exact agent refs, canonical full-definition digests, defensive input snapshots, and deterministic bounded
  argv expansion are immutable per invocation; exact parser reasons survive through normalization without a second parse.
- **Security:** authority-bearing carriers are authentic, invocation-bound, and one-use; structural equality grants no
  authority. Output conflicts fail closed, and independently redacted channels leave no raw-byte bypass to parser, evidence,
  subscribers, results, files, or faults.
- **Cancellation and shutdown:** when `capabilities.cancellation` is `true`, caller cancellation, deadlines, and shutdown
  dispatch an available provider-neutral graceful-cancellation hook best-effort without waiting or draining. A false capability
  or missing or failed hook follows the same immediate local path.
  Authoritative cleanup sends `SIGTERM` to the owned POSIX group, waits no more than 2 seconds, sends `SIGKILL` only while the
  group remains live, and requires confirmed group absence plus leader reap. The same local cleanup applies to natural-exit
  descendant sweep and identity-authorized recovery, while the first terminal candidate remains authoritative. Successful
  shutdown reaches typed completion before listeners are cleared, and unconfirmed cleanup fails closed.
- **Recovery safety:** consumer-selected persisted PID/process-group ids are never signalling authority without a freshly
  matching package-generated OS process fingerprint.
- **Backpressure:** every event, file, response, parser carry, protocol frame/count/write set, and completed registry has a
  hard bound. Paused I/O relies only on bounded operating-system pipes until one coordinator activates; v1 has no hidden async
  event queue or pre-bind protocol buffer.
- **Ownership:** every dispatched claim, preparation, spawn, cleanup, active-state, and publication operation has a registered
  owner, bounded settlement/quiescence, and a failed-closed retained-authority path.
- **Portability:** public durable contracts are provider-neutral JSON values and core logic does not depend on a consumer
  framework or database. Linux on local `ext4` is the first implementation/evidence cell, macOS requires separate native
  evidence, and Windows is unsupported and outside the MVP. None of these target statements claim shipped conformance.
- **Testability:** adapters share one lifecycle/result suite; architecture verification proves both allowed and forbidden
  dependency directions.
