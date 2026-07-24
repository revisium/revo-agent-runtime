# Architecture

## Purpose and status

`@revisium/revo-agent-runtime` will expose one process-local `AgentManager` for exact, versioned AI-agent invocations. Native
Codex, native Claude, and ACP will share one registry-access, executable-probing, process, observability, cancellation,
shutdown/reaping, JSON-result, output-file, and local active-process reconciliation boundary without taking ownership of
consumer orchestration or durable workflow state.

Only the internal agent discovery and probing slice is implemented and tested. The npm package remains
unpublished, the root package export remains empty, and the complete public AgentManager plus M2–M5 work remain target or
deferred. The normative public target is [the AgentManager v1 specification](./specs/agent-manager-v1.spec.md).

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
6. The manager snapshots agent identity and definition digest for every accepted invocation; execution never rereads the
   registry. On local `darwin`/`linux`, it also starts a separate process group, captures a verifiable OS process fingerprint,
   and saves the active row before returning the handle.
7. One native or ACP adapter runs the physical process while the manager bounds, redacts, records, and publishes events.
8. Leader exit triggers a full owned-group descendant sweep. Only confirmed group termination permits active-row removal and
   result handling. The manager then parses one top-level JSON object, validates it, attempts atomic terminal recording,
   retains a bounded
   process-local completion even after late recording failure, delivers exactly one process-local terminal event, and
   resolves result waiters.
9. The consumer shuts down the manager. Successful close stops acceptance, drains typed invocation completions, confirms
   kill/reap of owned invocation/probe processes, finishes terminal recording/events, then clears listeners.
10. Unconfirmed kill/reap rejects shutdown and leaves the manager permanently failed-closed. The consumer escalates host
    termination and creates no replacement in that supervision domain until process cleanup is resolved.
11. The consumer decides replacement in a resolved/new domain, active-row selection, retry, workflow, gate, indexing,
    retention, and recovery policy.

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
│       ├── invocation-executor.ts
│       ├── lifecycle.ts
│       ├── input-snapshot.ts
│       ├── argument-builder.ts
│       ├── result-collector.ts
│       ├── execution-ports.ts
│       └── limits.ts
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

| Area                       | Owns                                                                                                                                | Must not own                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `runtime/spec`             | Provider-neutral JSON-compatible type-only contracts behind domain and layer barrels.                                               | Runtime values, Node APIs, behavior, side effects, or test code.                              |
| `runtime/policy`           | Immutable limits, defaults, and stable message values.                                                                              | Specification, errors, definition behavior, or composition.                                   |
| `runtime/errors`           | Typed runtime errors that depend only on specification types.                                                                       | Policy, definition behavior, process, or composition.                                         |
| `runtime/definition`       | Plain-JSON inspection, closed definition validation, canonicalization, and digest.                                                  | Mutable registration, execution, process or filesystem access.                                |
| `runtime/registry`         | Exact `{ id, version }` lookup over one sealed immutable definition set.                                                            | Latest/fallback resolution, mutation after construction, execution.                           |
| `runtime/probe`            | Provider-neutral executable-probe ports and deterministic version-output interpretation.                                            | Concrete process mechanics, manager composition, agent selection, or scheduling.              |
| `runtime/execution`        | Input snapshots, bounded argv, one state machine, result validation, ports, and finalization.                                       | Consumer workflow concepts, concrete Node or provider mechanics.                              |
| `strategies/protocol`      | Native stdio and ACP framing behind execution ports.                                                                                | Manager composition, durable workflow state, direct file policy.                              |
| `strategies/result-parser` | Bounded provider-specific extraction of the final response and usage.                                                               | Product verdicts or consumer JSON Schema selection.                                           |
| `strategies/permissions`   | Translation of provider-neutral validated permission data into one provider invocation.                                             | Authorization policy or approval workflow decisions.                                          |
| `platform/process`         | Explicit environment, strict SemVer probe, group spawn, OS identity/fingerprint inspection, kill, and reaping.                      | Agent selection, credential policy, result semantics.                                         |
| `platform/filesystem`      | Exclusive leaf/result creation, `.scratch`, bounded recording, and flush mechanics.                                                 | Path construction, indexing, retention, restart recovery.                                     |
| `application`              | Manager composition, initialization, active-state sink ordering, registry/probe coordination, records, subscriptions, and shutdown. | Provider branches by agent id, database reads, distributed coordination, scheduling, retries. |
| `testing`                  | Deliberately published fakes or conformance harnesses after demonstrated consumer demand.                                           | Repository-only fixtures or a second production API.                                          |
| root `index.ts`            | Curated public exports implemented and proven together.                                                                             | Deep implementation barrels or accidental testing exports.                                    |

Tests mirror behavior rather than production folders:

```text
test/
├── unit/          # current private definition, registry, probe, and tooling behavior
├── contract/      # introduced only with public runtime behavior
├── integration/   # introduced only with process/filesystem/consumer behavior
├── package/       # current empty root entrypoint and metadata proof
└── support/       # current narrow definition builders and executable-probe fake
```

## Dependency direction

`runtime/spec` and `runtime/policy` are independent leaves. Errors type-import from specification only. Definition behavior
may depend on specification types, policy values, and errors. Registry builds immutable identity from definition and
specification. Probe owns provider-neutral executable-probe ports and uses definition parsing for strict version
interpretation. Execution is a parallel building block over portable contracts and its own ports. Registry, probe, and
execution do not import each other. Strategies and platform adapters implement execution ports without depending on each
other. Application is the sole composition root and wires registry, probe, execution, strategies, and platform together.

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
consumer-supplied active snapshot set, list and probe agents,
subscribe to events from all or one invocation, start and cancel work, list active and retained completed invocations,
return the same terminal result through handle, lookup, wait, and terminal-event paths, and shut down every process it owns.

The complete method set is summarized here only by responsibility; the
[AgentManager v1 specification](./specs/agent-manager-v1.spec.md) owns signatures and behavior.

| Responsibility             | API surface                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| Composition and faults     | `createAgentManager`, `AgentManagerError`                        |
| Local recovery barrier     | `initialize` with consumer-loaded active snapshots               |
| Pure sealed-registry reads | `listAgents`, `getAgent`                                         |
| Process-creating probe     | `probeAgent`                                                     |
| Future event observation   | `subscribe` plus returned `Unsubscribe`                          |
| Invocation acceptance      | `start` -> `AgentInvocationHandle`                               |
| Process-local state reads  | `listInvocations`, `getInvocation`, `getResult`, `waitForResult` |
| Handle synchronization     | handle `result`                                                  |
| Cancellation               | handle `cancel`, manager `cancel`                                |
| Process-local shutdown     | manager `shutdown`                                               |
| Handle identity            | `invocationId`, immutable execution `pin`                        |

Construction accepts an `ActiveInvocationStateSink` with `save` and `remove` only. The consumer loads active rows and passes
them to `initialize()`; the manager never queries a database. Initialization is one-shot and concurrency-safe. Before it
settles successfully, process-creating and observation operations are closed. The consumer owns integrity, provenance, and
selection of rows for this local manager. Duplicate or malformed snapshots fail before reconciliation; unknown/mismatched
pins and process identity conflicts are preserved as row failures while valid rows continue. Inspection, termination, or sink
uncertainty fails initialization closed after all independent work. Operation and total initialization deadlines bound every
path; retry requires a new manager and newly loaded rows. Pure sealed-registry reads and shutdown remain available.

The completed registry is bounded FIFO. Eviction makes an invocation unknown to the manager and does not touch consumer
files. The consumer owns durable indexing and may retain output-directory coordinates in its own attempt record.

Shutdown is the manager's concurrency-safe, idempotent process-local lifecycle boundary. Acceptance and closing have one
atomic boundary: a racing start is either accepted and drained or rejected without a handle or process. Closing rejects new
starts, probes, and subscriptions, cancels all active invocations, attempts termination, and requires confirmed reap of every
owned invocation/probe process. Successful closing waits through terminal output finalization and event delivery and only
then clears listeners. It does not independently clear or evict completed records; drain completions use normal bounded FIFO
and may evict older records. Handles retain their resolved results, process-local reads keep normal active/retained/unknown
semantics, and consumer output directories are never removed.

Shutdown before initialization closes an empty manager. Shutdown during initialization closes new work, aborts the current
abortable recovery operation, starts no more rows, and waits only to the initialization deadline while still requiring
confirmation for every process already signalled. It cannot hang indefinitely.

The first shutdown owns one shared settlement. Failure to confirm kill/reap rejects it with non-retryable
`revo.agent.shutdown_failed` and leaves the manager permanently failed-closed. New start/probe/subscription operations remain
closed, while registry and state reads remain available. An unreaped invocation remains active and is never falsely
completed. The consumer escalates host termination and does not create a replacement in the same supervision domain until
cleanup is externally resolved.

This lifecycle ownership does not make the package a workflow engine. The consumer still decides when to replace a closed
manager in a safe domain, which active rows belong to it, how to resolve distributed races, when to retry or reschedule work,
and how to reconcile durable workflow and result state.

Manager construction and invocation acceptance defensively copy JSON through canonical serialization and parse. Execution
retains no caller-owned definition, metadata, parameter, permission, result-schema, limit, or environment container. The
ephemeral start context explicitly allowlists inherited environment names and separates non-secret variables from secret
credentials. No child receives wholesale `process.env`; secret values join streaming redaction before spawn and are
discarded after finalization. Inherited and variable values are deliberately non-confidential and cannot use credential-like
names.

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

Active-state recovery v1 is local POSIX functionality for `darwin` and `linux`. Invocation processes start in a separate
process group. A bounded post-spawn sequence inspects the new child and creates opaque `sha256:<lowercase hex>` over
canonical, versioned, package-owned OS identity fields: process creation identity/time, resolved executable identity/path,
PID/process group, and local boot/session discriminator when supplied. It never fingerprints argv, environment, prompt,
credentials, or caller data. Invocation wall-clock time starts at successful spawn. Capture/save timeout kills and reaps
before start rejects. Unsupported platforms keep the existing non-recovery invocation path but accept only an empty recovery
set; v1 makes no Windows fingerprint or process-tree recovery promise.

The consumer-supplied row list is trusted selection/provenance input. The package does not prove ownership; exact fingerprint
comparison only protects against PID reuse and identity drift. An unknown/mismatched pin or live fingerprint mismatch is
preserved and reported, because mismatch may represent PID reuse, executable replacement, or corrupted state. Only a
definitely absent PID is removed. A live identity match receives group `SIGTERM`, a bounded wait, group `SIGKILL` when
needed, and confirmed termination before removal. Persisted PID/PGID values alone are never authority to signal.

The runtime saves `running` before returning a handle and attempts `cancelling` before the first cancellation signal.
Cancellation before spawn makes no sink call or signal; cancellation during post-spawn identity capture uses the live child
handle and writes no row. A bounded `cancelling` save failure is surfaced but does not prevent live kill/reap. After confirmed
termination, removal is attempted; a stale `running` row is safely removed on the next initialization when its PID is absent.
Snapshot state describes persisted process supervision and is distinct from `AgentInvocationStatus`.

Native Codex, native Claude, and ACP over stdio are non-reconnectable in v1. Initialization cleans them up; it does not
rehydrate an invocation handle, result waiter, event stream, or stdio session. Reconnectable ACP over a durable socket/daemon
is deferred. If the recorded group leader is already gone while descendants might remain, identity cannot be verified from
the stale group id; the runtime does not signal the group or claim descendant cleanup.

When a normally observed leader exits, the manager first sweeps and terminates descendants using its live owned group. It
removes active state and finalizes only after confirming the group is gone. Unconfirmed cleanup preserves the row, emits
typed `process_cleanup_failed`, and keeps the invocation nonterminal; continued shutdown uncertainty becomes
`shutdown_failed`. One bounded `remove` failure after confirmed cleanup leaves only a stale row and cannot change the result.
The active row has no terminal or pending-ack state.

## Output and observability boundary

The consumer supplies the exact invocation directory whose leaf must not exist. The manager creates parents, atomically
creates the leaf without adopting `EEXIST`, and owns `.scratch` plus five reserved filenames: `events.ndjson`, `stdout.log`,
`stderr.log`, failure-only `raw-final-response.txt`, and exclusive `result.json`. Result publication uses a flushed
same-directory temp plus non-replacing hard link. The manager never derives hierarchy, overwrites, deletes, rotates, or
chooses retention for consumer evidence. Controlled completion deletes only manager-owned scratch/temp paths; crash residue
may survive until consumer result recovery or retention removes the directory.

Events, stream data, result diagnostics, and files are bounded and redacted before leaving their owning boundary. The event
recorder reserves a relationally valid tail for one truncation diagnostic and one terminal event. Late I/O failure may leave
`result.json` absent or omit the terminal NDJSON line; those are incomplete audit records. The live manager still commits one
completed record and delivers exactly one process-local `invocation.finished`. Synchronous listeners do not create hidden
queues; listener failures are isolated from execution.

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
- active-row database/repository reads, row selection, distributed races, locks, leases, or claims;
- DBOS coordination, path construction, durable result/history indexing, file retention, recovery policy, or user-facing log
  projections;
- Git, GitHub, or other deterministic system operations;
- credentials policy, billing policy, or product verdict interpretation.

## Quality attributes

- **Determinism:** exact agent refs, canonical full-definition digests, defensive input snapshots, and deterministic bounded
  argv expansion are immutable per invocation.
- **Security:** output conflicts fail closed; secrets and unbounded provider data do not reach subscribers, files, or faults.
- **Cancellation and shutdown:** abort and manager close propagate through protocol shutdown and authoritative process
  kill/reap; successful shutdown reaches typed completion before listeners are cleared, and unconfirmed cleanup fails
  closed.
- **Recovery safety:** consumer-selected persisted PID/process-group ids are never signalling authority without a freshly
  matching package-generated OS process fingerprint.
- **Backpressure:** every event, file, response, and completed registry has a hard bound; v1 has no hidden async event queue.
- **Portability:** public durable contracts are provider-neutral JSON values and core logic does not depend on a consumer
  framework or database; active process recovery is explicitly local `darwin`/`linux` v1 functionality.
- **Testability:** adapters share one lifecycle/result suite; architecture verification proves both allowed and forbidden
  dependency directions.
