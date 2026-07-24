# Testing

This document defines how behavior in `@revisium/revo-agent-runtime` is proven. Exact executable commands remain in
[VERIFICATION.md](../VERIFICATION.md).

The policy adapts the library-level rules from `@revisium/revo-scripts` to an agent runtime. Host DBOS, pipeline, MCP,
GraphQL, UI, active-row repository, distributed coordination, and durable result-recovery layers do not belong in this
package. Package-owned local process reconciliation is tested here.

## Principles

- Behavior changes follow red -> green -> refactor. Run the focused test first and confirm it fails for the missing behavior,
  implement the smallest passing change, then improve structure without changing behavior.
- Every behavior has one primary proof layer. Higher layers may corroborate it without duplicating its full partition.
- Tests assert observable values, stable error codes, event order, file evidence, and causal diagnostics. A terminal status
  alone is insufficient when the contract exposes a reason.
- Fixtures contain every field read by production code. Deliberate omission is itself asserted behavior.
- Test support owns mechanics such as clocks, fake processes, recording subscribers, temporary directories, and definition
  builders. It does not choose product outcomes or hide assertions.
- Tests use public contracts unless a focused unit test owns a private pure function.
- Skips and quality-rule exclusions require an owner, rationale, and expiry or removal condition.

## Readability and suite structure

- Prefer small typed builders, scenario harnesses, and recording fakes over a fluent test DSL. Behavior choices and
  assertions remain visible in ordinary TypeScript.
- Builders expose explicit overrides and fail closed on unsupported combinations. They MUST NOT use an unbounded deep
  merge, infer expected outcomes, or derive expected values from actual results.
- One suite file owns one behavioral axis. Split independent concerns such as preflight, lifecycle, event policy, file
  bounds, cancellation, parsing, schema validation, or retention.
- More than 400 lines or ten top-level scenarios is a review trigger. A `describe` block does not replace focused files.
- Shared private mechanics live under `test/support/<area>/` only after repetition justifies them. There is no broad test
  barrel, and production never imports test support.
- Keep exceptional mechanics explicit when they are the subject of the test, such as controlled process signals or a
  subscriber that throws.

## Assertion style

- Use `expect(actual).toEqual(expected)` for complete definitions, results, failures, events, snapshots, and file manifests.
- Write expected values independently of actual values; do not spread the actual result into the expectation.
- Partial matching is reserved for deliberately open contracts and MUST NOT hide an owned field.
- Snapshots are reserved for complex deterministic serializable representations whose complete diff is easier to review
  than an object literal. Stable error codes and small contracts use explicit assertions.
- Normalize timestamps, generated ids, secrets, and machine paths unless the test specifically owns that representation.

## Test layers

| Layer        | Owns                                                                                                                                         | Must not own                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Unit         | Pure validation, canonicalization, digest/fingerprint records, redaction, limits, parsing, filters, and retention decisions.                 | Package export claims or broad process lifecycle.             |
| Contract     | Manager initialization, discovery, exact lookup, preflight, lifecycle, state-sink ordering, events, results, cancel/shutdown, stable faults. | Concrete Node process/filesystem behavior or private shape.   |
| Integration  | Real temporary process/group, OS inspection, filesystem, native/ACP framing, file atomicity, and consumer flow.                              | Revo workflow policy, durable retry, or public product APIs.  |
| Architecture | Dependency direction, cycle absence, forbidden imports, test-to-production direction, and probe efficacy.                                    | Runtime behavior or built package resolution.                 |
| Package      | Built declarations, root export map, ESM resolution, packed contents, and deep-import denial.                                                | Invocation semantics or future API behavior before it exists. |

Unit, narrow contract, architecture, and package lanes currently prove the implemented private internal agent discovery and probing slice plus the intentionally empty root export. The npm package remains unpublished; the complete public
AgentManager and M2–M5 remain deferred. Integration scripts are added when their owned process/filesystem behavior exists;
the repository does not keep empty lanes or permanent `passWithNoTests` configuration.

## Definition and registry proof

Definition, registry, and executable-probe tests must cover each implemented behavior below. Items that depend on execution
or the public AgentManager remain target requirements until those slices exist:

- closed draft 2020-12 schemas and stable validation diagnostics;
- RFC 8785 canonicalization and lowercase SHA-256 digest generation over the complete definition;
- rejection of non-plain/non-JSON input plus canonical serialize/parse copies that remain unchanged after caller mutation;
- duplicate exact identity, unsupported strategy, and incoherent delivery failures;
- exact prompt and result-schema template coherence; generic one-argument parameter encoding for every JSON value kind;
  deterministic permission expansion; own-property missing/omitted semantics; separate CLI literals; and per-item/count/total
  argv bounds;
- sealed construction with no mutation API;
- coexistence and exact lookup of two immutable versions of one agent id;
- absence of implicit latest selection or fallback;
- deterministic list order and direct no-shell probe behavior with bounded stdout/stderr, exact stream/prefix extraction,
  strict SemVer 2.0.0, AND-only comparator ranges, exit/timeout kill and reap, and every stable probe fault;
- snapshot identity remains stable when unrelated definitions are added.

Generic registry tests use arbitrary agent ids. They MUST NOT pass because an implementation branches on `codex` or
`claude`.

## AgentManager contract proof

Manager tests must prove:

- initialization is one-shot and concurrency-safe, copies the first caller input, and gates every non-registry manager
  operation except shutdown until its shared completion succeeds;
- duplicate and structurally malformed active snapshots reject before any process inspection, signal, or sink call;
- unknown/digest-mismatched pins are preserved as independent row failures without inspection, valid rows still reconcile,
  and aggregate initialization failure occurs only after independent work completes;
- consumer row selection/provenance is trusted input while the fingerprint proves only current process identity against PID
  reuse/drift, never package-established ownership;
- active-state operations and total initialization obey their configured deadlines, abort sink contexts, preserve current
  and unprocessed rows on expiry, and cannot apply a late timed-out mutation;
- active snapshots contain exactly invocation id, execution pin, `running | cancelling`, and process identity; they contain
  no result, terminal status, prompt, credential, environment, metadata, output directory, or consumer workflow field;
- `running` is saved after process-identity capture and before an accepted handle is returned; `cancelling` is attempted
  before the first cancellation signal; leader exit sweeps/confirms the owned group before removal or finalization;
- initial save failure kills and reaps the just-spawned owned process before start rejects, and no handle or known untracked
  process remains;
- cancellation save failure emits a bounded diagnostic but still kills/reaps through the live child handle, then attempts
  removal; it cannot by itself force `shutdown_failed` or host termination;
- active-row removal failure emits one bounded diagnostic, leaves a stale consumer row, and cannot change or delay the
  existing terminal result semantics;
- initialization removes definitely missing rows, never signals or removes live fingerprint/PID mismatches, terminates and
  reaps identity matches before removal, and preserves rows plus fails closed on inspection, termination, or sink uncertainty;
- initialization of native Codex, native Claude, and ACP-over-stdio rows performs cleanup only and never recreates handles,
  events, result waiters, completed records, stdio, or ACP sessions;
- `invocationId` validation and uniqueness across active and retained completed records;
- exact agent pin `{ agentId, agentVersion, definitionDigest }` is captured once and execution does not reread the registry;
- metadata, parameters, permissions, result schema, limits, and environment are package-owned snapshots unaffected by caller
  mutation after acceptance;
- parameter, permission, result-schema, workspace, relational-limit, environment, and output-path preflight failures reject
  before acceptance;
- no wholesale process environment inheritance, no inherited variables by default, duplicate environment-key rejection,
  credential-like-name rejection in nonsecret inherit/variables, secret auto-redaction before spawn, split-chunk redaction,
  and unredacted-buffer disposal;
- pre-handle spawn failures reject start after cleanup; post-acceptance process, protocol, output, parsing, validation,
  timeout, and cancellation failures resolve typed terminal results rather than rejecting result waiters;
- one subscription can observe all invocations or exactly one filtered invocation;
- per-invocation sequence ordering and exactly one process-local `invocation.finished` delivery;
- subscriber failure isolation and no hidden async event buffer;
- handle result, `waitForResult`, completed `getResult`, and terminal event expose the same completed value;
- a terminal event handler can synchronously observe the completed lookup;
- filtered listing covers active and retained terminal invocations without a separate completed-run collection;
- bounded FIFO completion eviction never removes active work, makes evicted ids unknown, and permits reuse only after
  eviction;
- cancel is idempotent and terminal races commit exactly one outcome;
- cancellation before spawn settles cancelled without sink/signal; cancellation after spawn but before initial snapshot uses
  the live child handle, writes no snapshot, and does not confuse persisted supervision state with invocation status;
- shutdown is idempotent, the first call creates one shared fulfillment/rejection, and only its copied/bounded/redacted reason
  is used; the first close atomically partitions racing starts into accepted-and-drained or `manager_closed` without a
  handle/process;
- shutdown before initialization closes an empty manager; shutdown during initialization stops new rows, aborts/waits only
  to the initialization deadline, and confirms every recovery process already signalled without hanging indefinitely;
- after closing begins, new start/probe operations reject and subscribe throws `revo.agent.manager_closed`, while exact
  registry reads, process-local list/get/result/wait APIs, existing handles, manager cancel, and idempotent unsubscribe remain
  usable;
- shutdown requests cancellation for every active invocation, waits for typed terminal completion, output finalization, and
  exactly one terminal event before clearing listeners, and does not reject for invocation execution failure;
- shutdown has no independent clear/eviction pass, drain completions use normal bounded FIFO and may evict older records,
  evicted-record handles retain their resolved result, and consumer output directories are never deleted;
- inability to confirm any owned invocation/probe kill and reap rejects the shared completion exactly once with bounded,
  redacted, non-retryable `revo.agent.shutdown_failed` in phase `shutdown`, including affected invocation ids/truncation and
  probe count; every later shutdown observes the same rejection;
- after shutdown failure the manager remains failed-closed, registry/state reads remain available, and an unreaped invocation
  stays active without a false terminal result;
- natural leader exit with unconfirmed descendant cleanup preserves the active row and nonterminal invocation with typed
  `process_cleanup_failed`; confirmed later cleanup may finalize failed, while continued uncertainty becomes
  `shutdown_failed`;
- late stream/raw recording failure replaces the provisional result with `revo.agent.output_write_failed`, while `.scratch`
  cleanup failure produces `revo.agent.scratch_cleanup_failed`;
- result commit failure leaves `result.json` absent, commits the same failed value in memory without recursive persistence,
  and still resolves every process-local result channel;
- terminal NDJSON append failure after a successful result commit emits a bounded process-local diagnostic, cannot mutate the
  result, and still delivers one terminal event.

## Result proof

Result tests must partition:

- one top-level JSON object that passes the consumer's draft 2020-12 schema;
- empty output, primitive JSON, array JSON, malformed JSON, schema mismatch, and oversized response;
- no text-success path;
- raw-response preview and failure-only file for extraction, parse, object, and validation failures;
- redaction before object validation, subscriber delivery, diagnostics, raw preview, and every file write;
- the result files contract includes `result.json` only when atomic commit succeeded;
- stable bounded errors without secret values or unbounded provider output; explicitly nonsecret inherit/variable values are
  not promised confidentiality;
- technical success carrying consumer-level `completed`, `blocked`, or `needs_human` values without manager policy.

## Process, protocol, and filesystem proof

Integration tests use package-owned narrow process/filesystem seams and real temporary fixtures. They do not globally mock
`node:child_process` or the filesystem.

Required behavior includes:

- separate `darwin`/`linux` process-group spawn, stdin, stdout, stderr, exit, signal, timeout, cancellation,
  process-tree kill, and reaping;
- process fingerprint capture and recovery recomputation use the same versioned canonical OS identity fields, produce exact
  `sha256:<64 lowercase hex>`, use exact byte comparison, and never include argv, environment, prompts,
  credentials, metadata, or application `startedAt`;
- inability to capture required identity after spawn kills and reaps before rejection; recovery inspection uncertainty sends
  no signal, preserves the row, and fails closed;
- recovered identity match sends process-group `SIGTERM`, performs a bounded wait, escalates to group `SIGKILL`, and confirms
  termination; a PID/PGID alone is never sufficient authority;
- unsupported-platform empty initialization preserves existing non-recovery execution, while non-empty recovery fails closed
  without inspection, signal, sink mutation, or a Windows fingerprint/process-tree promise;
- a missing recorded leader with possible surviving descendants removes the stale row without signalling the group and does
  not report descendant cleanup;
- natural leader exit sweeps and terminates all in-memory owned group descendants before row removal and finalization;
  unconfirmed cleanup preserves the row and cannot publish terminal completion;
- shutdown kills and reaps every owned invocation process and every racing in-flight probe process before resolving, with no
  accepted invocation or probe left orphaned; an interrupted probe rejects `manager_closed` only after reap;
- a kill/reap confirmation failure does not report successful shutdown, clear listeners, or synthesize invocation
  completion; it produces the shared `shutdown_failed` rejection for consumer host-termination escalation;
- native Codex, native Claude, and ACP conformance to one event/result/error contract;
- no-shell deterministic argv expansion, total argv bounds, owner-only `<output>/.scratch`, reap-before-cleanup, cleanup
  attempt before terminal commit, typed cleanup failure, and crash-residue recovery ownership;
- ACP correlation, hostile input, permissions, cancellation, and session isolation;
- recursively create missing parents, atomically create a non-existing output leaf, reject every `EEXIST`, and prove two
  concurrent managers targeting one leaf have exactly one winner;
- never adopt, overwrite, delete, rotate, or suffix an existing output leaf;
- bounded `events.ndjson`, `stdout.log`, `stderr.log`, and failure-only `raw-final-response.txt` with explicit truncation
  diagnostics or markers;
- relational limit validation, including active-state operation <= initialization, idle <= wall, and an events-file
  reservation for one truncation diagnostic, one terminal event, and both newline bytes;
- invocation wall-clock timing starts at successful spawn and includes post-spawn identity/save latency rather than starting
  at logical acceptance or handle return;
- exclusive same-directory result temp creation, file flush, non-replacing hard link, supported directory flush, temp unlink,
  `EEXIST`/unsupported-filesystem failure, and concurrent publication without replacement;
- required normal finalization order plus every late-I/O branch where process-local completion survives an incomplete audit
  record.

## Architecture proof

Architecture tests distinguish type-only portable spec, immutable policy, typed errors, definition behavior, sealed
registry, execution core, strategy adapters, platform adapters, application composition, public entrypoint, and test
support. They enforce the dependency direction in [architecture.md](./architecture.md).

The committed architecture harness MUST:

1. lint the current positive production and owned-test graph;
2. synthesize temporary definition-to-probe, probe-to-registry, and root-to-probe imports and prove each configured rule
   exits non-zero;
3. synthesize a consumer direct import from a private `runtime/spec` file and prove it exits non-zero;
4. synthesize a temporary import cycle and prove cycle detection exits non-zero;
5. validate one entity per production leaf, type-only specification leaves, explicit barrels, `.js` specifiers, and the
   required domain/layer barrel boundaries with representative negative probes;
6. remove all probes even after failure.

A configuration change is not proven by a green graph that happens to contain no violation.

## Package proof

The package lane during bootstrap proves:

- the source root has no accidental public API;
- package metadata declares the intended ESM-only root export;
- build emits JavaScript, source maps, declarations, and declaration maps;
- `publint` validates source package metadata and exports before packing;
- one package-owned orchestrator creates one exact tarball with an isolated temporary npm cache;
- `@arethetypeswrong/cli`, content validation, isolated ESM execution, strict TypeScript resolution, and deep-import denial
  all consume that same tarball;
- the packed tarball resolves at runtime in an isolated ESM consumer;
- TypeScript resolves the packed declaration entrypoint in an isolated strict consumer;
- an undeclared deep import is rejected with `ERR_PACKAGE_PATH_NOT_EXPORTED`;
- packed contents contain only declared public files.

This does not prove AgentManager behavior. Package tests evolve with public exports only when implementation, declarations,
tests, and README examples are introduced together.

When the target API is implemented, package/type-surface proof MUST include the factory
`createAgentManager(options): AgentManager`, public `AgentManagerError` with its readonly `AgentFault`, the complete manager
surface including `initialize(snapshots)`, `shutdown(reason?: string): Promise<void>`, the `ActiveInvocationStateSink` and
snapshot contracts, and the complete invocation-handle surface.

## Coverage and quality metrics

- Coverage uses Vitest's v8 provider and writes `coverage/lcov.info`.
- Thresholds match the sibling library floor: 80% branches and 90% functions, lines, and statements.
- Coverage includes owned production source and excludes tests, fixtures, declarations, generated output, package tarballs,
  build output, and repository tooling.
- New production files are not excluded to satisfy a threshold or Sonar result.
- Package and architecture tests remain required even when they do not contribute meaningful production branch coverage.

## Authoring workflow

1. Select the primary proof layer.
2. Add the smallest failing behavior test and confirm the expected failure.
3. Implement the smallest sufficient behavior.
4. Run the focused owning lane.
5. Refactor only after green, preserving one abstraction level per unit.
6. Run `pnpm verify` before handoff, commit, or publication.
7. Run applicable conditional and remote gates from `VERIFICATION.md`.
