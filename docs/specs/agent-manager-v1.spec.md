# AgentManager v1 target specification

- Status: Draft
- Implementation: Not implemented
- Target package: `@revisium/revo-agent-runtime`
- Schema dialect: JSON Schema draft 2020-12
- Related decisions: [ADR-0002](../adr/0002-agent-manager-consumer-boundary.md),
  [ADR-0003](../adr/0003-invocation-output-recording.md)

This document is normative for the target v1 API. `MUST`, `MUST NOT`, `SHOULD`, and `MAY` are requirements terms. The
package currently exports no runtime values or types; these declarations describe the contract to implement and test.

## 1. JSON-compatible values

Public durable values MUST be JSON-compatible.

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonSchema202012 = JsonObject;
```

Every schema supplied to v1 MUST declare `"$schema": "https://json-schema.org/draft/2020-12/schema"`. Results MUST be a
top-level JSON object; arrays, primitives, empty output, and unstructured text cannot be successful results.
Numbers MUST be finite; `NaN`, infinities, `undefined`, functions, symbols, bigint values, sparse arrays, and cyclic objects
are invalid public input.

## 2. Agent definitions and identity

```ts
interface AgentRef {
  readonly id: string;
  readonly version: string;
}

type AgentArgumentTemplate =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'prompt' }
  | { readonly kind: 'prompt-file' }
  | { readonly kind: 'result-schema' }
  | { readonly kind: 'result-schema-file' }
  | { readonly kind: 'parameter'; readonly name: string; readonly omitIfMissing?: boolean }
  | { readonly kind: 'permission'; readonly name: string; readonly omitIfMissing?: boolean };

interface AgentVersionProbe {
  readonly args: readonly string[];
  readonly stream: 'stdout' | 'stderr';
  readonly prefix?: string;
  readonly timeoutMs: number;
}

interface AgentDefinition {
  readonly schemaVersion: 'agent-definition/v1';
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description?: string;
  readonly launch: {
    readonly command: string;
    readonly args: readonly AgentArgumentTemplate[];
    readonly versionProbe?: AgentVersionProbe;
  };
  readonly protocol: {
    readonly driver: 'native/stdio-v1' | 'acp/v1';
    readonly resultParser?: 'codex-jsonl/v1' | 'claude-stream-json/v1';
    readonly permissionStrategy: 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';
  };
  readonly delivery: {
    readonly prompt: 'argument' | 'stdin' | 'file' | 'protocol';
    readonly resultSchema: 'argument' | 'file' | 'protocol';
    readonly result: 'stdout' | 'protocol';
  };
  readonly parameters: {
    readonly schema: JsonSchema202012;
    readonly defaults?: JsonObject;
  };
  readonly permissions: {
    readonly schema: JsonSchema202012;
    readonly defaults?: JsonObject;
  };
  readonly capabilities: {
    readonly cancellation: boolean;
    readonly structuredResult: true;
    readonly usage: boolean;
  };
  readonly constraints?: {
    readonly platforms?: readonly ('darwin' | 'linux' | 'win32')[];
    readonly executableVersion?: string;
  };
}

interface AgentDescriptor {
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly displayName: string;
  readonly description?: string;
  readonly capabilities: AgentDefinition['capabilities'];
}
```

Definition ids and versions MUST be non-empty bounded strings. The pair `{ id, version }` is unique. Multiple versions of
one id MAY coexist. There is no implicit latest version, compatible-version search, or fallback.

Construction accepts only plain JSON data. For each definition the manager validates bounds and shape, RFC 8785
canonical-serializes the complete definition, computes lowercase hexadecimal SHA-256 over those exact UTF-8 bytes, parses
the canonical bytes into package-owned data, and deep-freezes that parsed copy. The registry retains no caller-owned object,
array, or buffer reference. Starting an invocation snapshots the exact `agentId`, `agentVersion`, and `definitionDigest`;
execution MUST NOT reread the registry.

`native/stdio-v1` definitions MUST select a package-owned result parser. `acp/v1` obtains the result through ACP and MUST
omit `resultParser`. Unknown strategy ids and incoherent combinations fail manager construction.

`native/stdio-v1` requires `delivery.result: 'stdout'` and forbids protocol delivery for prompt and result schema. `acp/v1`
requires protocol delivery for prompt, result schema, and result. A permission strategy must belong to the selected driver
and provider family.

Argument templates are interpreted by package code and checked against delivery mode:

- `delivery.prompt: 'argument'` requires exactly one `prompt` item and forbids `prompt-file`;
- `delivery.prompt: 'file'` requires exactly one `prompt-file` item and forbids `prompt`;
- `delivery.prompt: 'stdin' | 'protocol'` forbids both prompt items;
- `delivery.resultSchema: 'argument'` requires exactly one `result-schema` item and forbids `result-schema-file`;
- `delivery.resultSchema: 'file'` requires exactly one `result-schema-file` item and forbids `result-schema`;
- `delivery.resultSchema: 'protocol'` forbids both result-schema items.

Literal, workspace, prompt, prompt-file, result-schema, and result-schema-file items each produce exactly one argument.
Inline and file schema content is RFC 8785 canonical JSON. A parameter item reads one exact own top-level property from the
effective parameters object after default overlay and schema validation, and emits exactly one argument: strings unchanged;
finite numbers as their canonical JSON number; booleans as `true` or `false`; null as `null`; and objects or arrays as RFC
8785 canonical JSON. CLI flags are separate literal items. Missing means no own property, including after defaults; it fails
preflight unless `omitIfMissing` is true. `false`, `0`, an empty string, and `null` are present values. Each emitted argument
must satisfy the per-argument and total argv bounds.

Permission items delegate to the selected package-owned permission strategy, which returns a deterministic bounded argument
sequence. Definitions cannot inject consumer callbacks or executable code.

The manager invokes `launch.command` directly without a shell. Argument values are never shell-expanded. Definition
parameter and permission defaults MUST validate at construction. For each invocation, request properties replace defaults
with the same top-level key; there is no recursive merge. The resulting complete objects validate before acceptance.

File delivery uses `<output.directory>/.scratch` with restrictive permissions: `0700` for the directory and `0600` for files
on POSIX platforms, with equivalent owner-only access elsewhere. Scratch paths are never returned in events or results. The
manager rejects symbolic-link conflicts and attempts controlled cleanup after process reap and before terminal commit.
Preparation, write, or flush failures map to `revo.agent.scratch_failed`; cleanup failure maps to
`revo.agent.scratch_cleanup_failed`. A process crash may leave `.scratch` residue. Consumer recovery or retention may remove
the whole invocation directory; the manager never scans or adopts residue from a prior invocation.

## 3. Manager construction, registry reads, and probing

```ts
interface AgentManagerOptions {
  readonly definitions: readonly AgentDefinition[];
  readonly limits?: AgentManagerLimits;
  readonly redaction?: {
    readonly secrets: readonly string[];
  };
}

interface AgentManagerLimits {
  readonly wallClockTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxEventBytes?: number;
  readonly maxEventsFileBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxRawResponseBytes?: number;
  readonly maxCompletedInvocations?: number;
}

declare function createAgentManager(options: AgentManagerOptions): AgentManager;

interface AgentProbeAvailable {
  readonly status: 'available';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly executable: string;
  readonly reportedVersion?: string;
}

interface AgentProbeUnavailable {
  readonly status: 'unavailable';
  readonly agent: AgentRef;
  readonly definitionDigest: string;
  readonly error: AgentFault;
}

type AgentProbeResult = AgentProbeAvailable | AgentProbeUnavailable;
```

Construction validates and seals the complete registry. An invalid definition, duplicate exact ref, digest failure, or
unsupported strategy throws `AgentManagerError` synchronously. V1 has no `register`, `unregister`, or `replaceDefinitions`
method. To change definitions, the consumer constructs a new manager.

`listAgents()` is deterministic and sorted by id, then version. `getAgent()` uses exact identity. `probeAgent()` checks the
exact definition's executable and optional version constraint without starting an invocation. Probe unavailability is a
typed result, not an exception; an unknown exact ref rejects with `revo.agent.agent_unknown`.

A version probe invokes the definition command directly without a shell and uses only `versionProbe.args`. Both stdout and
stderr are independently capped at 64 KiB. The probe must exit zero before its timeout; timeout kills and reaps the process.
The selected stream is strict UTF-8, must contain no NUL, and is decoded as follows: remove at most one
terminal LF and its immediately preceding CR; require no other leading or trailing whitespace; when `prefix` is present,
require an exact case-sensitive prefix and remove it; parse the remainder as strict SemVer 2.0.0. Empty remainder, extra
lines, malformed UTF-8, nonzero exit, overflow, timeout, or a prefix mismatch returns a stable probe fault.

Fault mapping is exact: spawn failure -> `revo.agent.probe_spawn_failed`; timeout -> `revo.agent.probe_timeout`; nonzero exit
-> `revo.agent.probe_process_failed`; either stream overflow -> `revo.agent.probe_output_too_large`; UTF-8, NUL, newline,
whitespace, prefix, empty remainder, or SemVer parse failure -> `revo.agent.probe_output_invalid`; comparator mismatch ->
`revo.agent.probe_version_mismatch`.

`constraints.executableVersion` accepts only whitespace-separated AND comparators, each formed by `=`, `>`, `>=`, `<`, or
`<=` followed immediately by a strict SemVer 2.0.0 value. Bare versions, caret, tilde, wildcard, `x`, hyphen range, comma,
and `||` syntax are rejected at manager construction. Every comparator must match the extracted version. Probe args obey the
same item, per-argument, and total argv bounds as invocation args.

An executable-version constraint requires a version probe. A present prefix must be non-empty and within its byte bound.
Definitions with an invalid timeout, prefix, comparator expression, or incoherent constraint fail manager construction.

## 4. Starting an invocation

```ts
interface StartAgentInvocation {
  readonly invocationId: string;
  readonly agent: AgentRef;
  readonly prompt: string;
  readonly workspace: {
    readonly directory: string;
  };
  readonly parameters: JsonObject;
  readonly permissions: JsonObject;
  readonly metadata?: JsonObject;
  readonly result: {
    readonly schema: JsonSchema202012;
  };
  readonly limits?: {
    readonly wallClockTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxEventBytes?: number;
    readonly maxEventsFileBytes?: number;
    readonly maxStdoutBytes?: number;
    readonly maxStderrBytes?: number;
    readonly maxRawResponseBytes?: number;
  };
  readonly output: {
    readonly directory: string;
  };
}

interface AgentStartContext {
  readonly signal?: AbortSignal;
  readonly environment?: {
    readonly inherit?: readonly string[];
    readonly variables?: Readonly<Record<string, string>>;
    readonly secrets?: Readonly<Record<string, string>>;
  };
}

interface AgentExecutionPin {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
}

interface AgentInvocationHandle {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  result(): Promise<AgentInvocationResult>;
  cancel(reason?: string): Promise<CancelInvocationResult>;
}
```

`invocationId` is an opaque consumer identifier. It has no package-defined relationship to a Revo run, step, or attempt.
Such identifiers MAY be placed in `metadata`, which the manager stores and returns without interpreting.

`start()` requires an exact agent ref. It validates the request, result schema, parameters, permissions, limits, workspace,
and output path; reserves the id; prepares the output directory; and returns a handle. An id is unique among active and
retained completed records. Duplicate ids fail preflight. Once a completed record has been evicted, its id MAY be reused.

Acceptance is atomic with manager shutdown. If shutdown begins while `start()` is in preflight, exactly one outcome is
allowed: either the invocation is accepted into the active registry and included in shutdown, or `start()` rejects with
`revo.agent.manager_closed` without returning a handle or spawning a process.

Before returning the handle, the manager canonical-serializes and parses package-owned copies of metadata, effective
parameters, effective permissions, the result schema, and effective limits. It copies the prompt, paths, and environment
strings into package-owned storage. Later mutation of caller objects cannot affect execution. The ephemeral `AbortSignal` is
the only retained caller object and is not part of a durable or digested value.

The output directory is mandatory, opaque, and exclusively owned by one accepted invocation. Its leaf MUST NOT exist. The
manager creates missing parent directories, then performs one atomic non-recursive leaf-directory creation. Any `EEXIST`,
including an existing empty directory or symbolic link, fails preflight with `revo.agent.output_conflict`; the manager never
adopts an existing leaf. Concurrent starts targeting the same leaf have one winner and all others fail closed. The manager
MUST NOT overwrite, delete, rotate, or suffix consumer-owned or committed paths; deletion is limited to manager-owned
`.scratch` and temporary publication paths inside the newly claimed leaf.

Workspace and output directories MUST be normalized absolute paths. The manager does not require one to contain the other
and does not infer a hierarchy.

The child environment is explicit. Nothing from `process.env` is inherited by default, and the child never receives a
wholesale copy. `environment.inherit` names individual host variables to capture during preflight; missing named variables
fail preflight. `variables` contains explicit non-secret values. `inherit` and `variables` are explicitly non-confidential:
their names and values may appear if the child emits them. A key whose name contains, case-insensitively,
`token|secret|password|credential|api[_-]?key|private[_-]?key` is forbidden in `inherit` and `variables` and must be supplied
through `secrets` instead.

`secrets` contains credential values, which are copied only for the invocation and automatically registered with streaming
redaction before spawn. Duplicate keys across `inherit`, `variables`, and `secrets`, an empty secret value, an invalid key,
or any environment bound violation fails preflight with `revo.agent.environment_invalid`. Definitions contain no
credentials; the consumer owns credential storage and selection. Environment keys MUST match
`^[A-Za-z_][A-Za-z0-9_]*$`; repeated names within one collection also count as duplicates.

Streaming redaction MUST detect secret values split across stdout, stderr, or protocol chunks. Unredacted carry buffers and
secret copies are discarded after finalization. Secret values never enter definition digests, events, results, output files,
or process-local completed records. No confidentiality promise applies to `inherit` or `variables`.

Preflight failures reject `start()` with `AgentManagerError` and no handle. After acceptance, spawn, process, protocol,
timeout, cancellation, output, result parsing, and result validation failures resolve the handle with a typed terminal
`AgentInvocationResult`; they do not reject `result()`.

## 5. State and lifecycle

```ts
type AgentInvocationStatus =
  | 'accepted'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

type AgentTerminalStatus = Extract<
  AgentInvocationStatus,
  'succeeded' | 'failed' | 'cancelled' | 'timed_out'
>;

interface AgentInvocationSnapshot {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly status: AgentInvocationStatus;
  readonly metadata?: JsonObject;
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly outputDirectory: string;
}

interface AgentInvocationFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly statuses?: readonly AgentInvocationStatus[];
}
```

Allowed state transitions are:

```text
accepted -> starting -> running -> succeeded | failed | timed_out
accepted -> cancelling -> cancelled
starting -> cancelling -> cancelled
running  -> cancelling -> cancelled
```

Failures may transition `accepted`, `starting`, `running`, or `cancelling` to `failed`. Exactly one terminal transition is
allowed. Cancellation racing with natural completion resolves to whichever terminal transition commits first.

## 6. Result contract

```ts
interface AgentUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly reportedCost?: number;
  readonly reportedCurrency?: string;
}

interface AgentProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

interface AgentOutputFiles {
  readonly directory: string;
  readonly events: 'events.ndjson';
  readonly stdout: 'stdout.log';
  readonly stderr: 'stderr.log';
  readonly result?: 'result.json';
  readonly rawFinalResponse?: 'raw-final-response.txt';
}

interface AgentCommittedOutputFiles extends AgentOutputFiles {
  readonly result: 'result.json';
}

interface AgentInvocationResultBase {
  readonly schemaVersion: 'agent-invocation-result/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly metadata?: JsonObject;
  readonly acceptedAt: string;
  readonly startedAt?: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exit: AgentProcessExit;
  readonly usage?: AgentUsage;
  readonly files: AgentOutputFiles;
}

interface AgentInvocationSucceeded extends AgentInvocationResultBase {
  readonly status: 'succeeded';
  readonly files: AgentCommittedOutputFiles;
  readonly value: JsonObject;
}

interface AgentRawResponseDiagnostic {
  readonly preview: string;
  readonly truncated: boolean;
  readonly file?: 'raw-final-response.txt';
}

interface AgentInvocationFailed extends AgentInvocationResultBase {
  readonly status: 'failed';
  readonly error: AgentFault;
  readonly rawResponse?: AgentRawResponseDiagnostic;
}

interface AgentInvocationCancelled extends AgentInvocationResultBase {
  readonly status: 'cancelled';
  readonly files: AgentCommittedOutputFiles;
  readonly error: AgentFault;
}

interface AgentInvocationTimedOut extends AgentInvocationResultBase {
  readonly status: 'timed_out';
  readonly files: AgentCommittedOutputFiles;
  readonly error: AgentFault;
}

type AgentInvocationResult =
  | AgentInvocationSucceeded
  | AgentInvocationFailed
  | AgentInvocationCancelled
  | AgentInvocationTimedOut;
```

Success requires all of the following:

1. process and protocol completion satisfy the selected adapter contract;
2. the selected protocol produces one final response;
3. the bounded response parses as JSON;
4. the parsed value is a top-level object;
5. string values are redacted;
6. the redacted object validates against the consumer's draft 2020-12 schema;
7. output files and atomic `result.json` finalize successfully.

Technical success does not imply product success. A consumer schema can represent `completed`, `blocked`, or
`needs_human` inside `value`; the consumer decides workflow behavior.

On missing, invalid, oversized, or schema-invalid final output, status is `failed`, `error` identifies the stable cause,
and the bounded redacted raw response is available through `rawResponse` plus `raw-final-response.txt`. No successful
unstructured-text result exists.

## 7. Errors

```ts
type AgentFaultCode =
  | 'revo.agent.definition_invalid'
  | 'revo.agent.definition_duplicate'
  | 'revo.agent.strategy_unsupported'
  | 'revo.agent.manager_closed'
  | 'revo.agent.shutdown_failed'
  | 'revo.agent.agent_unknown'
  | 'revo.agent.invocation_invalid'
  | 'revo.agent.invocation_duplicate'
  | 'revo.agent.invocation_unknown'
  | 'revo.agent.workspace_invalid'
  | 'revo.agent.parameters_invalid'
  | 'revo.agent.permissions_invalid'
  | 'revo.agent.result_schema_invalid'
  | 'revo.agent.limit_invalid'
  | 'revo.agent.environment_invalid'
  | 'revo.agent.output_path_invalid'
  | 'revo.agent.output_conflict'
  | 'revo.agent.scratch_failed'
  | 'revo.agent.scratch_cleanup_failed'
  | 'revo.agent.probe_spawn_failed'
  | 'revo.agent.probe_timeout'
  | 'revo.agent.probe_process_failed'
  | 'revo.agent.probe_output_too_large'
  | 'revo.agent.probe_output_invalid'
  | 'revo.agent.probe_version_mismatch'
  | 'revo.agent.spawn_failed'
  | 'revo.agent.process_failed'
  | 'revo.agent.protocol_failed'
  | 'revo.agent.authentication_failed'
  | 'revo.agent.permission_denied'
  | 'revo.agent.output_write_failed'
  | 'revo.agent.result_missing'
  | 'revo.agent.result_invalid_json'
  | 'revo.agent.result_not_object'
  | 'revo.agent.result_schema_mismatch'
  | 'revo.agent.result_too_large'
  | 'revo.agent.cancelled'
  | 'revo.agent.timeout'
  | 'revo.agent.internal';

interface AgentFault {
  readonly code: AgentFaultCode;
  readonly message: string;
  readonly phase:
    | 'construction'
    | 'manager'
    | 'shutdown'
    | 'preflight'
    | 'probing'
    | 'starting'
    | 'running'
    | 'collecting_result'
    | 'finalizing';
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

declare class AgentManagerError extends Error {
  readonly fault: AgentFault;
}
```

Error messages and details are bounded and redacted. They MUST NOT contain secret values, unbounded stdout/stderr, or an
unbounded raw provider response. Explicitly non-secret inherited and variable environment values have no confidentiality
guarantee. JSON Schema diagnostics use JSON Pointer paths and bounded messages.

## 8. Events and subscriptions

```ts
interface AgentEventBase {
  readonly schemaVersion: 'agent-event/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly sequence: number;
  readonly timestamp: string;
}

type AgentEvent =
  | (AgentEventBase & { readonly type: 'invocation.accepted' })
  | (AgentEventBase & { readonly type: 'invocation.started' })
  | (AgentEventBase & {
      readonly type: 'invocation.output';
      readonly stream: 'stdout' | 'stderr';
      readonly text: string;
    })
  | (AgentEventBase & {
      readonly type: 'invocation.diagnostic';
      readonly code: string;
      readonly message: string;
    })
  | (AgentEventBase & { readonly type: 'invocation.cancelling'; readonly reason?: string })
  | (AgentEventBase & {
      readonly type: 'invocation.finished';
      readonly result: AgentInvocationResult;
    });

interface AgentEventFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly types?: readonly AgentEvent['type'][];
}

type Unsubscribe = () => void;
type AgentEventListener = (event: AgentEvent) => void;
```

`subscribe(filter, listener)` observes all matching future events. `{}` observes every invocation; `{ invocationId }`
observes one. Delivery is ordered per invocation by strictly increasing `sequence`. Listener failure is isolated, converted
to a bounded diagnostic for other listeners, and MUST NOT change invocation outcome. The failing listener is unsubscribed
before that diagnostic is delivered, preventing recursive failure. Delivery is synchronous after the applicable internal
recording attempt; a slow listener applies consumer-side latency but cannot create an unbounded package queue. V1 does not
expose `AsyncIterable`.

Every accepted invocation delivers exactly one process-local `invocation.finished` while the manager process remains alive.
Before delivery, the manager MUST make the completed record visible to `getResult`. The terminal event carries the same
immutable result value returned by the handle and manager result APIs. Filesystem recording is best-effort only after a late
I/O failure and does not weaken process-local terminal delivery.

## 9. Manager methods

```ts
type AgentResultLookup =
  | { readonly state: 'running'; readonly invocation: AgentInvocationSnapshot }
  | { readonly state: 'completed'; readonly result: AgentInvocationResult }
  | { readonly state: 'unknown' };

type CancelInvocationResult =
  | { readonly state: 'requested' }
  | { readonly state: 'already_completed'; readonly result: AgentInvocationResult }
  | { readonly state: 'unknown' };

interface AgentManager {
  listAgents(): readonly AgentDescriptor[];
  getAgent(agent: AgentRef): AgentDescriptor | undefined;
  probeAgent(agent: AgentRef): Promise<AgentProbeResult>;

  subscribe(filter: AgentEventFilter, listener: AgentEventListener): Unsubscribe;

  start(request: StartAgentInvocation, context?: AgentStartContext): Promise<AgentInvocationHandle>;
  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[];
  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined;
  getResult(invocationId: string): AgentResultLookup;
  waitForResult(invocationId: string): Promise<AgentInvocationResult>;
  cancel(invocationId: string, reason?: string): Promise<CancelInvocationResult>;
  shutdown(reason?: string): Promise<void>;
}
```

`getResult` is non-throwing and distinguishes running, retained completed, and unknown. `waitForResult` immediately returns
a retained completed result, waits for an active invocation, and rejects an unknown id with
`revo.agent.invocation_unknown`. Handle `result()` follows the same rule for its accepted invocation and never rejects for
an execution failure.

`listInvocations()` returns active and retained completed snapshots only. Terminal filters provide the completed list; no
separate `completedRuns` collection exists. Results are ordered by `acceptedAt`, then `invocationId`.

Cancellation is idempotent. Unknown returns `unknown`; retained completion returns `already_completed`; active work returns
`requested` after cancellation is committed. Cancellation reason is bounded and redacted.

`shutdown(reason?)` closes the manager's process-local supervision domain. It is idempotent and concurrency-safe: the first
call atomically marks the manager closing and creates one shared completion promise. Concurrent and later calls return that
completion and observe its same fulfillment or rejection. The first call's copied, bounded, redacted reason is authoritative;
reasons on later calls are ignored.

Once closing begins, a new `start()` or `probeAgent()` rejects and a new `subscribe()` throws `AgentManagerError` with fault
code `revo.agent.manager_closed`, phase `manager`, and `retryable: false`. Pure sealed-registry reads `listAgents` and
`getAgent` remain available. Process-local state reads `listInvocations`, `getInvocation`, `getResult`, and `waitForResult`
also remain available with their normal retained/active/unknown semantics. Existing handles remain usable, including their
`result()` and idempotent `cancel()` methods. Manager `cancel()` retains its existing result contract. Probing is a
process-creating operation, not a pure discovery read.

A probe racing the close is either registered as in flight and included in shutdown or rejects `manager_closed` without
spawning. An included probe whose process has not completed is terminated and its caller rejects `manager_closed` after the
process is reaped. A racing subscription is either registered before closing and later cleared by shutdown or throws
`manager_closed`; it is never installed after closing.

Shutdown applies the same 4 KiB bound and redaction rules as cancellation reasons and requests cancellation of every active
invocation. It attempts termination and requires confirmed reap of every manager-owned child process and in-flight
version-probe process. On successful shutdown, every accepted invocation reaches typed terminal completion, completes output
finalization, publishes its retained completed record, and delivers its terminal event before shutdown clears remaining
listeners and resolves. Invocation execution or finalization failures do not reject shutdown; they remain typed invocation
results. Existing unsubscribe functions remain idempotent before, during, and after listener clearing.

Shutdown does not run an independent completed-record clear or eviction pass. Completions produced while draining enter the
normal bounded FIFO and MAY evict older completed records under the ordinary retention rule. An invocation handle retains
its resolved terminal result even if that result's completed record is later evicted. Shutdown never deletes consumer output
directories or performs restart recovery.

Failure to confirm kill and reap of any owned invocation or probe process rejects the shared shutdown completion with
`AgentManagerError`: code `revo.agent.shutdown_failed`, phase `shutdown`, and `retryable: false`. Its bounded, redacted
`details` reports affected invocation ids, whether that id list was truncated, and the affected probe count; it exposes no
command, environment, or provider output. Invocation execution failures alone never cause this rejection.

After `shutdown_failed`, the manager remains permanently failed-closed. New `start`, `probeAgent`, and `subscribe` operations
still fail with `revo.agent.manager_closed`; every later `shutdown` returns the same rejected completion; and the registry and
process-local state reads above remain available. An invocation whose reap cannot be confirmed remains in its nonterminal
active record and its result MUST NOT be falsely completed. Existing listeners are cleared only after successful drain; on
failure they remain idempotently unsubscribable while an affected invocation is still observable.

The consumer MUST escalate host termination after `shutdown_failed` and MUST NOT create a replacement manager in the same
supervision domain until process ownership is externally resolved. Workflow policy, retry, replacement in a resolved/new
domain, and restart recovery remain consumer responsibilities.

## 10. Bounds, redaction, and retention

Manager limits become per-invocation defaults. An invocation may lower a configurable manager value but cannot exceed it.
Values outside the minima and hard maxima fail construction or preflight.

| Configurable limit                | Minimum              | Default    | Hard maximum |
| --------------------------------- | -------------------- | ---------- | ------------ |
| Wall-clock timeout                | 1,000 ms             | 30 minutes | 1,800,000 ms |
| Idle timeout                      | 1,000 ms             | 5 minutes  | 300,000 ms   |
| One serialized non-terminal event | 1 KiB                | 64 KiB     | 64 KiB       |
| `events.ndjson`                   | Terminal reservation | 16 MiB     | 16 MiB       |
| `stdout.log`                      | 64 KiB               | 8 MiB      | 8 MiB        |
| `stderr.log`                      | 64 KiB               | 8 MiB      | 8 MiB        |
| Raw final response                | 64 KiB               | 1 MiB      | 1 MiB        |
| Retained completed records        | 1                    | 1,000      | 1,000        |

The idle timeout MUST be less than or equal to the wall-clock timeout. `maxEventsFileBytes` MUST be at least
`terminalReservation`, where:

```text
terminalReservation = maxTerminalEventBytes + maxEventBytes + 2 newline bytes
maxTerminalEventBytes = 2 MiB
```

The non-terminal events budget is `maxEventsFileBytes - terminalReservation`. The reserved tail holds at most one bounded
truncation diagnostic and one terminal event. The terminal event bound is fixed so a 1 MiB result plus bounded metadata,
diagnostics, and envelope fits.

Additional fixed hard bounds are:

| Value                               | Hard maximum             |
| ----------------------------------- | ------------------------ |
| Serialized invocation metadata      | 64 KiB                   |
| Serialized parameters               | 256 KiB                  |
| Serialized permissions              | 256 KiB                  |
| Serialized result schema            | 1 MiB                    |
| UTF-8 prompt                        | 4 MiB                    |
| Generated arguments                 | 4,096 items, 1 MiB total |
| One generated argument              | 256 KiB                  |
| One complete agent definition       | 1 MiB                    |
| Definitions per manager             | 1,000                    |
| Agent id, version, or invocation id | 256 bytes each           |
| Display name                        | 256 bytes                |
| Description or cancellation reason  | 4 KiB                    |
| Workspace or output path            | 16 KiB                   |
| Environment                         | 128 keys, 256 KiB total  |
| Environment key                     | 128 bytes                |
| Environment value                   | 64 KiB                   |
| Configured redaction secrets        | 1,000 values, 64 KiB sum |
| Fault message                       | 8 KiB                    |
| Serialized fault details            | 64 KiB                   |
| Each version-probe stream           | 64 KiB                   |
| Version-probe prefix                | 1 KiB                    |

Byte limits are serialized UTF-8 byte counts. Generated prompt and canonical result-schema arguments must satisfy both their
content bounds and the per-argument, argument-count, and total-argv bounds. The command itself is included in total argv
bytes. Environment counts are across inherited names, variables, and secrets after duplicate detection.
Version-probe timeout must be between 1,000 and 30,000 ms inclusive.

Idle activity means bounded stdout or stderr bytes, a valid protocol frame, or a process exit. Subscriber work, file flushes,
and internal timers do not reset the idle deadline. The wall-clock deadline starts at acceptance and is authoritative even
when an injected test clock stalls.

Redaction runs before every subscriber delivery and every file write. It covers configured literal secrets and built-in
credential-like patterns. Truncation is explicit:

- stdout and stderr end with one bounded truncation marker within their file limit;
- the events recorder reserves one terminal-event slot for `invocation.finished`, emits one bounded
  `invocation.diagnostic` truncation event, and suppresses later non-terminal events when its budget is exhausted;
- raw response diagnostics contain a bounded preview and `truncated: true` when applicable;
- an oversized final response fails with `revo.agent.result_too_large`.

Completed retention is FIFO by `finishedAt`, then `invocationId`. When adding a completion exceeds the configured capacity,
the oldest completed record is evicted after the new record is committed. Active invocations are not counted and never
evicted. Evicted records become `unknown` to lookup, wait, cancel, and list methods. Files remain untouched; file retention
belongs to the consumer.

## 11. File finalization

For every accepted invocation the manager owns these reserved filenames in the exact consumer directory:

```text
.scratch/               # ephemeral; removed on controlled completion
events.ndjson
stdout.log
stderr.log
raw-final-response.txt  # failure-only
result.json
```

Every complete NDJSON line is one bounded `AgentEvent`. When present, `result.json` is one complete serialized
`AgentInvocationResult`. Exclusive publication uses a same-directory temporary file opened with exclusive creation, followed
by write and file flush, `link(temp, result.json)`, directory flush where supported, and unlink of the manager-owned temp.
`EEXIST` at `result.json`, lack of required same-filesystem hard-link semantics, or another publication failure maps to
`revo.agent.output_write_failed`; the manager never uses replacing rename semantics. A temp unlink failure after a successful
link produces a bounded diagnostic and cannot mutate the committed result. Consumer retention may later remove residue with
the invocation directory.

Terminal process-local completion MUST proceed even when late recording fails. Finalization order is:

1. derive a provisional typed outcome, including bounded result extraction, parse, redaction, top-level-object check, and
   draft 2020-12 validation when applicable;
2. attempt removal of invocation `.scratch` after process reap;
3. flush bounded redacted non-terminal events, streams, and failure-only raw response evidence;
4. if scratch cleanup failed, replace the provisional outcome with `status: 'failed'` and
   `revo.agent.scratch_cleanup_failed`; otherwise, if a recording step before result commit failed, replace it with
   `status: 'failed'` and `revo.agent.output_write_failed`;
5. attempt exclusive same-directory publication of that terminal value to `result.json`;
6. if the result commit fails, create the same in-memory `revo.agent.output_write_failed` result with `files.result` absent;
   do not recursively retry result persistence;
7. add the immutable in-memory completed record and apply FIFO eviction;
8. best-effort append and flush the one `invocation.finished` record to `events.ndjson`;
9. if that terminal filesystem append fails, deliver one bounded process-local diagnostic before the terminal event; the
   append failure cannot mutate a successfully committed result;
10. deliver exactly one process-local `invocation.finished`, then resolve handle and manager result waiters.

Exactly-one terminal delivery is a process-local invariant, not a promise that the terminal line reached the filesystem.
A handler receiving it MUST observe `{ state: 'completed', result }` from `getResult(invocationId)`. `result.json` may be
absent only when its atomic commit failed; its absence, or a missing terminal NDJSON record, is an incomplete audit record
for consumer recovery. Neither condition prevents the live manager from exposing the terminal result. A process crash is
outside the process-local exactly-once guarantee.

## 12. Consumer example

```ts
const manager = createAgentManager({ definitions: [codexDefinition] });

const stopAll = manager.subscribe({}, (event) => publish(event));

const invocationId = attempt.id;
const stopOne = manager.subscribe({ invocationId }, (event) => inspect(event));

const handle = await manager.start(
  {
    invocationId,
    agent: { id: 'codex', version: '1.0.0' },
    prompt,
    workspace: { directory: workspace.path },
    parameters: { model: 'gpt-5' },
    permissions: { mode: 'workspace-write', network: false },
    metadata: { runId: run.id, stepId: step.id, attemptId: attempt.id },
    result: { schema: roleResultSchema },
    output: { directory: attempt.agentOutputDirectory },
  },
  {
    signal,
    environment: {
      inherit: ['PATH', 'HOME', 'TMPDIR', 'LANG'],
      variables: { CI: 'true' },
      secrets: { OPENAI_API_KEY: apiKey },
    },
  },
);

const result = await handle.result();
const lateLookup = manager.getResult(invocationId);
const terminal = manager.listInvocations({
  statuses: ['succeeded', 'failed', 'cancelled', 'timed_out'],
});

stopOne();
stopAll();
```

## 13. Explicitly deferred

- runtime registration or replacement of definitions;
- latest-version or compatibility fallback;
- durable database storage, restart rehydration, or directory scanning;
- package-owned run, step, attempt, retry, pipeline, or scheduling concepts;
- async iterators, replayable subscriber cursors, or cross-process fan-in;
- process pooling or ACP session reuse across invocations;
- consumer-defined protocol, parser, or permission strategy injection;
- text-success results.
