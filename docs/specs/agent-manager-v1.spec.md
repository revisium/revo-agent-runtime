# AgentManager v1 target specification

- Status: Draft
- Version: 1.0.0
- Implementation: Provider-neutral implementation and curated root export available
- Target package: `@revisium/revo-agent-runtime`
- Schema dialect: JSON Schema draft 2020-12
- Related decisions: [ADR-0002](../adr/0002-agent-manager-consumer-boundary.md),
  [ADR-0003](../adr/0003-invocation-output-recording.md),
  [ADR-0006](../adr/0006-consumer-backed-active-invocation-recovery.md),
  [ADR-0008](../adr/0008-real-mechanics-supervision-boundary.md),
  [ADR-0009](../adr/0009-process-signal-authority.md),
  [ADR-0010](../adr/0010-consumer-warranted-stable-output-ancestors.md),
  [ADR-0011](../adr/0011-consumer-governed-local-supervision.md), and
  [ADR-0013](../adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md)
- Private execution contract: [B+ execution handoff specification](./execution-handoff.spec.md)

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, and OPTIONAL in this document are to be interpreted as
described in RFC 2119 and BCP 14.

This document is normative for the target v1 API. The current source exports the provider-neutral `createAgentManager`,
`AgentManagerError`, and their complete curated named type surface. Implemented source, tests, declarations, and package
exports remain the truth while this specification retains draft status; release availability is external metadata.

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

interface AgentExecutionPin {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
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
    readonly versionProbe: AgentVersionProbe;
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

Every target-v1 definition MUST provide `launch.versionProbe`; it is not optional even when `constraints.executableVersion` is absent. `native/stdio-v1` definitions MUST select a package-owned result parser. `acp/v1` obtains the result through ACP and MUST
omit `resultParser`. Unknown strategy ids and incoherent combinations fail manager construction.

`native/stdio-v1` requires `delivery.result: 'stdout'` and forbids protocol delivery for prompt and result schema. `acp/v1`
requires protocol delivery for prompt, result schema, and result. A permission strategy must belong to the selected driver
and provider family.

`capabilities.cancellation: false` means the selected adapter exposes no provider graceful-cancellation dispatch. When it is
`true`, the selected adapter MAY expose one provider-neutral dispatch. In either case, cancellation, deadline expiry, and
shutdown use the same authoritative local cleanup; a missing, failed, or incomplete provider dispatch never delays or replaces
that cleanup.

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
  readonly activeStateSink: ActiveInvocationStateSink;
  readonly limits?: AgentManagerLimits;
  readonly redaction?: {
    readonly secrets: readonly string[];
  };
}

interface ActiveInvocationStateSink {
  save(snapshot: ActiveInvocationSnapshot, context: ActiveStateOperationContext): Promise<void>;
  remove(invocationId: string, context: ActiveStateOperationContext): Promise<void>;
}

interface ActiveStateOperationContext {
  readonly signal: AbortSignal;
}

type ActiveInvocationState = 'running' | 'cancelling';

interface ActiveProcessIdentity {
  readonly pid: number;
  readonly processGroupId: number;
  readonly fingerprint: string;
  readonly startedAt: string;
}

interface ActiveInvocationSnapshot {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly state: ActiveInvocationState;
  readonly process: ActiveProcessIdentity;
}

interface AgentManagerLimits {
  readonly activeStateOperationTimeoutMs?: number;
  readonly initializationTimeoutMs?: number;
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
  readonly reportedVersion: string;
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

The consumer supplies the `activeStateSink`; the manager never reads from it. The consumer owns its database or repository,
loads the active rows selected for this local manager, and passes them to `initialize()`. The sink MUST store only active
snapshots and MUST treat `save` as replacement by `invocationId`. It has no result/history, query, claim, lease, lock, host,
or workflow methods. Consumer DBOS integration, retries, distributed coordination, and row ownership stay outside this
contract.

Every sink operation receives a package-owned abort signal and MUST stop without applying a late write after that signal is
aborted. The manager aborts the call when `activeStateOperationTimeoutMs` or the remaining initialization deadline expires.
A timeout is the same typed sink/recovery failure as a rejection. This bounds package waiting without allowing a timed-out
`remove` to delete a later invocation that reused the same id. Each invocation has one package-owned serialized active-state
lane. If the manager aborts an already-dispatched `save`, fulfilment of that same `save` promise after abort is the sink's
confirmation that every mutation caused by that operation is quiesced. Rejection or abort alone is not confirmation. The
manager waits for that fulfilment through one additional bounded `activeStateOperationTimeoutMs` quiescence window; a promise
that does not fulfil in that window leaves quiescence unknown. A rejected `save` cannot later furnish that fulfilment and also
leaves quiescence unknown. Only confirmed quiescence MAY be followed by a compensating
`remove`, and a dispatched save releases its guard/reservation only after that `remove` fulfils. `remove` MUST be
absent-row-safe and idempotent for a `running` save that may have been applied even though its caller observed timeout or
rejection. If quiescence is unknown, the manager MUST NOT call `remove`, MUST retain the private guard/reservation, and becomes
failed-closed; that id is not reusable until consumer-backed reconciliation by a fresh manager.

An active snapshot contains no result, terminal status, prompt, environment, credential, metadata, or output directory.
The consumer already owns durable output coordinates, and they are not required for process identity comparison. Snapshot
values MUST be defensively copied, plain JSON-compatible data within the existing id/string bounds.

`listAgents()` is deterministic and sorted by id, then version. `getAgent()` uses exact identity. `probeAgent()` checks the
exact definition's resolved executable and required strict-SemVer version probe without starting an invocation. Probe
unavailability is a typed result, not an exception; an unknown exact ref rejects with `revo.agent.agent_unknown`. On an
available result, `executable` is the resolved absolute path and `reportedVersion` is the strict-SemVer proof; this evidence
does not expose the command string, argv, environment, fingerprint, or provider output.

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

Every definition requires a version probe. An executable-version constraint is checked against that required probe. A present prefix must be non-empty and within its byte bound.
Definitions with an invalid timeout, prefix, comparator expression, or incoherent constraint fail manager construction.

### Initialization and active-process recovery

`initialize(snapshots)` is the one-shot asynchronous readiness barrier. The first call defensively copies its complete input
and creates one shared completion. Concurrent and later calls return that same completion; their arguments are ignored.
Successful initialization is required before `probeAgent`, `subscribe`, `start`, invocation state/result methods,
cancellation, or other process-local reads. Before success those operations fail with
`revo.agent.manager_not_initialized`; pure `listAgents`, `getAgent`, and `shutdown` remain available. A rejected
initialization leaves the manager permanently failed-closed; retry requires a new manager and a freshly loaded consumer row
set.

Before any process inspection, signal, or sink call, initialization validates every snapshot and rejects the whole input with
`revo.agent.recovery_invalid` if any row is structurally malformed or an `invocationId` is duplicated. Invalid input causes
no partial reconciliation. Exact pin availability and digest agreement are row-level recovery checks, not whole-input
structural validation.

The consumer-supplied list is trusted selection input for this local manager. The consumer owns row integrity, coordination,
and the claim that a selected row came from its earlier manager. The package does not prove that provenance: fresh process
identity comparison only prevents signalling a different process after PID reuse or executable/identity drift.

### Signal authority and context-specific outcomes

This section is the normative trace for [ADR-0009](../adr/0009-process-signal-authority.md).

Persisted `pid`, `processGroupId`, `invocationId`, `pin`, `startedAt`, and any future persisted epoch are correlation data
only. They never authorize a signal, reap, or descendant-cleanup claim in either normal supervision or recovery. Normal
in-memory signalling uses only the manager's authentic private live process capability, the coordinator to which that
capability was transferred, or the authentic retained cleanup owner. Recovery cleanup has a separate authority source: a
fresh package observation whose recomputed fingerprint exactly matches the saved fingerprint. `invocationId`, pin, and an
epoch remain consumer/workflow correlation even when they identify the same row.

| Context                                                               | Required outcome                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery: leader is definitely absent                                 | Remove only the stale row. Do not signal its persisted group and do not claim descendant cleanup.                                                   |
| Recovery: fingerprint mismatch or required observation is unavailable | Preserve the row; send no signal; report `revo.agent.recovery_failed`.                                                                              |
| Recovery: fresh exact fingerprint match                               | Signal, terminate, and reap only the identity-matched group; remove the row only after confirmed reap.                                              |
| Recovery: `activeStateSink` operation fails                           | Preserve the row and report `revo.agent.recovery_failed`.                                                                                           |
| Post-spawn before identity/save acceptance                            | The preregistered process-start attempt owns the authentic live capability while I/O remains paused.                                                |
| Post-spawn identity capture or initial `running` save fails           | Confirmed cleanup MUST precede `start()` rejection. Unconfirmed cleanup MUST retain the authentic cleanup owner and reservation for shutdown retry. |
| Initial `running` save was dispatched                                 | Post-abort fulfilment of that same save MUST confirm quiescence.                                                                                    |
| Initial `running` save quiescence was confirmed                       | An absent-row-safe `remove` MUST fulfil before the guard, cleanup owner, or reservation is released.                                                |
| Initial `running` save quiescence or removal remains unresolved       | The same authentic authority and reservation MUST remain registered.                                                                                |
| Live cancellation or shutdown: `cancelling` save fails                | Emit bounded diagnostic evidence and continue live-owned cleanup.                                                                                   |
| Accepted invocation: reap cannot be confirmed                         | Keep that public invocation active and nonterminal; during shutdown reject the shared completion with `revo.agent.shutdown_failed`.                 |
| Confirmed reap, then `remove` fails                                   | Keep the result unchanged, retain a stale row, and emit bounded diagnostic evidence.                                                                |

### Option A: pre-acceptance lifecycle

On supported local POSIX platforms, a start remains pre-acceptance until the package has captured its identity, fulfilled the
initial `running` save, atomically accepted the invocation, and created its handle while process I/O remains paused. Claim,
output preparation, and process start are each preregistered in shutdown drainage before their dispatch. Sole-coordinator
registration and one-use I/O activation occur only after acceptance. None of the preregistered preacceptance operations
creates public state. After confirmed cleanup of a pre-acceptance child, `start()` rejects; it releases the private id
reservation only when no initial save was dispatched or the dispatched save's post-abort fulfilment confirmed quiescence and
a removal of the maybe-persisted row fulfilled. It emits no
`invocation.accepted`, `invocation.started`,
`invocation.cancelling`, or `invocation.finished` event; creates no completed record, result, retention entry, or result
publication; and leaves `getInvocation`, `getResult`, `waitForResult`, `cancel`, and `listInvocations` with their ordinary
unknown semantics for that id. After confirmed cleanup and any required fulfilled row removal, the id is immediately reusable.

An unconfirmed reap is the Option A/U1 exception to release: `start()` still rejects without a public invocation. For
identity capture or initial-save failure its primary fault remains `revo.agent.process_identity_failed` or
`revo.agent.active_state_failed` with bounded redacted cleanup-uncertain detail. The manager retains its private owned-child
guard and id reservation, so public lookup remains unknown but the id is not reusable in that supervision domain. Shutdown
retries the same bounded cleanup; if it remains unconfirmed, its shared completion rejects with
`revo.agent.shutdown_failed`. The consumer externally resolves the process before replacing that supervision domain.

Cancellation before `running` is distinct from live cancellation of an accepted invocation: before spawn it performs no sink
call or process signal. After spawn but before initial `running` save dispatch, it uses only the private live-owned capability
to terminate and reap the child; confirmed cleanup rejects `start()` with its bounded cancellation cause and releases the
reservation. After initial save dispatch, the row is maybe-persisted even before the save promise settles: confirmed reap
must be followed by post-abort save fulfilment within the bounded quiescence window and then a fulfilled absent-row-safe,
idempotent `remove` before releasing the guard/reservation. A missing fulfilment, rejection, or remove
rejection/uncertainty keeps the id unavailable and leaves the manager failed-closed for consumer-backed reconciliation by a
fresh manager. If a post-spawn pre-acceptance cancellation cannot confirm reap,
`start()` rejects with primary
`revo.agent.process_cleanup_failed` and bounded redacted cancellation cause; it creates no public invocation, retains the
private owned-child guard/reservation, and shutdown retries bounded cleanup before `revo.agent.shutdown_failed`. Cancellation
after `running` follows the ordinary active invocation cancellation contract.

This private rejected-start path is not the accepted unreaped path. Once a handle has been returned, unconfirmed reap leaves
an observable active invocation nonterminal under the ordinary lifecycle rules; it does not retroactively reject `start()`.

Valid rows are reconciled in `invocationId` order:

- if the exact agent pin is absent from the sealed registry or its digest differs, preserve the row without process
  inspection or signalling and report a row recovery failure;
- if the recorded PID is definitely absent, call `activeStateSink.remove(invocationId, context)`;
- if a live PID's recomputed fingerprint does not match, never signal that process, preserve the row, and report an identity
  conflict;
- if a live PID has a verified identity match, terminate and reap its process group, then remove the row;
- if inspection cannot determine existence or identity, send no signal, preserve the row, and report recovery failure;
- if termination/reap cannot be confirmed or a sink call fails, preserve the row and report recovery failure.

Initialization continues reconciling independent valid rows after one recovery failure, then rejects its shared completion
with bounded `revo.agent.recovery_failed` details. The details identify only a bounded set of invocation ids and failure
categories; they do not expose executable paths, process arguments, environment, prompts, credentials, or provider output.
The consumer MUST retain exact definitions for selected active rows or remediate preserved unknown/mismatched-pin rows before
constructing a replacement manager; the runtime never silently prunes them.

Initialization has one `initializationTimeoutMs` deadline starting when the first `initialize()` call begins. Each inspection,
fingerprint, termination, and sink call is also bounded by `activeStateOperationTimeoutMs` and the remaining initialization
time. When the total deadline expires, the
manager aborts the current abortable operation, starts no additional rows, preserves the current and unprocessed rows, and
reports them in the aggregate recovery failure. A sink MUST honor its abort signal as described above.

Native Codex, native Claude, and ACP over stdio are non-reconnectable. Initialization never recreates handles, subscriptions,
stdio, ACP sessions, result waiters, completed records, or terminal results for supplied rows. If a recorded leader has
exited while descendants may remain, the persisted process-group id alone is not sufficient identity evidence: initialization
removes the stale row without signalling that group and does not claim descendant cleanup. Reconnectable ACP over a durable
socket or daemon is deferred.

Active-state persistence and restart cleanup in v1 are local POSIX features supported on `darwin` and `linux`. On another
platform, `initialize([])` succeeds and the existing non-recovery invocation API remains usable without active snapshots;
non-empty initialization preserves every row and fails with `revo.agent.recovery_failed` without inspection, signalling, or
sink mutation. V1 makes no Windows fingerprint or process-tree recovery promise.

`fingerprint` is opaque to the consumer and has exact form `sha256:` followed by 64 lowercase hexadecimal digits. The
package computes SHA-256 over the RFC 8785 canonical UTF-8 bytes of this package-internal record produced by its platform
inspector:

```ts
interface ProcessFingerprintRecordV1 {
  readonly schemaVersion: 'process-fingerprint/v1';
  readonly platform: 'darwin' | 'linux';
  readonly pid: number;
  readonly processGroupId: number;
  readonly creationIdentity: string;
  readonly executablePath: string;
  readonly executableIdentity: string;
  readonly bootSessionIdentity: string | null;
}
```

`creationIdentity` is the OS-reported process creation identity/time in the platform adapter's stable normalized
representation. `executablePath` is the resolved absolute executable path and `executableIdentity` is the platform file
identity for that executable. `bootSessionIdentity` is the local OS boot/session discriminator, or `null` only when the OS
does not supply one. PID and process-group id are positive safe integers. Every string is copied exactly from the normalized
inspector result; no locale-formatted time is allowed. The record MUST NOT contain argv, environment, prompt, credentials,
metadata, application `startedAt`, or other caller-controlled mutable data. Recovery uses the same inspector and recomputes
the canonical record and fingerprint; comparison uses exact byte equality.

A mismatch may mean PID reuse, executable replacement/drift, or corrupted/stale consumer state. V1 cannot safely distinguish
those cases, so mismatch is never treated as proof that the recorded invocation ended and is never silently removed.

`startedAt` is an RFC 3339 application timestamp captured after spawn for observability only. It does not establish process
identity and is never substituted for OS creation identity. If the platform cannot capture the required identity after spawn,
the invocation kills and reaps the owned child through its private live-owned capability, then rejects `start()`. If recovery
inspection cannot obtain the required fields, it sends no signal and preserves the row.

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

interface AgentInvocationHandle {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  result(): Promise<AgentInvocationResult>;
  cancel(reason?: string): Promise<CancelInvocationResult>;
}
```

`invocationId` is an opaque consumer identifier. It has no package-defined relationship to a Revo run, step, or attempt.
Such identifiers MAY be placed in `metadata`, which the manager stores and returns without interpreting.

`start()` requires successful initialization and an exact agent ref. An `invocationId` is unique among pending
preacceptance starts, active invocations, and retained completed records. Once a completed record is evicted, its id MAY be
reused. A rejected preacceptance start releases its reservation only after every dispatched operation is quiescent, process
cleanup is confirmed, and any maybe-persisted active row is confirmed removed.

The private execution handoff follows this exact phase chain:

1. defensively snapshot the complete request and context and reserve the invocation id;
2. read the sealed registry exactly once and complete every deterministic preclaim preparation step;
3. drain-register the claim attempt before dispatching exclusive output-leaf creation;
4. after a successful claim, drain-register output-preparation authority before its first filesystem mutation;
5. bind attested claimed resources into one authentic one-use prepared execution;
6. drain-register the process-start attempt before native spawn dispatch;
7. after actual spawn acceptance, arm wall-clock, idle, and active-state setup deadlines while stdout and stderr remain
   unpumped;
8. inspect identity, capture the fingerprint, and fulfil the initial `running` save within the one active-state setup deadline;
9. atomically accept the invocation and create the handle while process I/O remains paused; and
10. drain-register the sole duplex coordinator, activate I/O exactly once, and enter running/postacceptance drainage.

The [private execution-handoff specification](./execution-handoff.spec.md) controls the authentic carriers, settlement,
quiescence, and fixed private bounds for these phases. A claim timeout or unknown claim state retains the identical claim
guard. Preparation rejection or uncertainty retains the identical publication and cleanup authority. Neither condition
creates a public invocation. A spawn failure proves that no child exists; every post-spawn rejection instead has confirmed
cleanup or retains the authentic live cleanup authority.

Before claim, the manager completes all request and definition canonicalization, default application, package-owned defensive
copies, consumer-schema compilation, permission mapping, explicit environment capture, workspace and output admission,
template interpretation, prospective bound checks, registered-secret substring checks for prospective argv and scratch
payloads, platform admission, and fresh executable proof. It copies the prompt, paths, and environment strings into
package-owned storage. The ephemeral `AbortSignal` is the only retained caller object and is not part of a durable or
digested value. Later mutation of caller objects cannot affect execution. No deterministic caller, definition, binding,
permission, environment, workspace, schema, platform, probe, or prospective-bound failure first appears after claim.

Immediately before output-leaf claim, the manager checks the definition's platform constraint, freshly resolves
`launch.command`, and executes the required `launch.versionProbe` against that resolution. A previous `probeAgent()` result
is never launch authority. A supported platform and successful strict-SemVer proof produce immutable launch evidence with the
resolved absolute executable path and reported version. The invocation launches that exact absolute path directly, without a
shell, another resolution, or command rewriting. An unsupported invocation cell fails preclaim with
`revo.agent.platform_unsupported`; every supported local invocation cell follows the same identity/save acceptance contract.
The fresh launch proof is distinct from the post-spawn fingerprint, which protects recovery identity rather than executable
eligibility.

Shutdown and start arbitrate at each preregistration boundary. If shutdown closes new work before a phase is registered, that
phase is not dispatched. If registration commits first, shutdown drains the same registered owner under its operation-owned
bound. A pending start that never reaches acceptance rejects without an event, result, completed record, retention entry, or
result publication.

The output directory is mandatory, opaque, and exclusively claimed by one pending start or accepted invocation. Its leaf MUST
NOT exist. The consumer MUST provision the hierarchy through the leaf's existing parent and warrant that every output
ancestor remains trusted and stable until terminal filesystem quiescence. The manager MUST NOT create missing output
ancestors. A missing or non-directory parent fails preflight with `revo.agent.output_path_invalid`. The manager performs one
atomic non-recursive leaf-directory creation. Any `EEXIST`, including an existing empty directory or symbolic link, fails
preflight with `revo.agent.output_conflict`; the manager never
adopts an existing leaf. Concurrent starts targeting the same leaf have one winner and all others fail closed. The manager
MUST NOT overwrite, delete, rotate, or suffix consumer-owned or committed paths; deletion is limited to manager-owned
`.scratch` and temporary publication paths inside the newly claimed leaf. A rejected pre-acceptance start publishes no result
or terminal lifecycle record. Its claimed leaf is consumer-owned quarantined residue: the manager cleans only its own scratch
and temporary paths, never deletes the leaf, and a retry using that same path fails with `revo.agent.output_conflict`. Consumer
retention eventually removes the residue; a retry uses a fresh output path.

Workspace and output directories MUST be normalized absolute paths. `workspace.directory` MUST exist and identify a directory
at preflight or fail with `revo.agent.workspace_invalid` before output-leaf claim or invocation spawn. The consumer authorizes
the workspace; the manager does not require workspace/output containment or infer a hierarchy. It makes no workspace
`realpath`, symlink, ownership, provenance, containment, or hostile-rebinding safety claim. For output ancestors, v1 relies on
the consumer warranty: ancestor identity, symlink
resolution, mount topology, and access policy MUST remain stable from preflight until no package filesystem operation for the
start remains pending. For a rejection before leaf claim, that point is `start()` rejection. For a claimed leaf, all
recording, publication, flush, scratch/temp cleanup attempts, and terminal filesystem append attempts MUST have settled and
the start rejection or terminal result path MUST have settled. Reported or retained filesystem uncertainty extends the
warranty until consumer reconciliation; process exit or elapsed time alone does not end it. The manager does not prove
consumer provenance or hostile-ancestor safety with normalization, realpath, or containment checks. Workspace trust,
authorization, and output-ancestor trust remain separate responsibilities.

The child environment is explicit. Nothing from `process.env` is inherited by default, and the child never receives a
wholesale copy. `environment.inherit` names individual host variables to capture during preflight; missing named variables
fail preflight. `variables` contains explicit non-secret values. `inherit` and `variables` are explicitly non-confidential:
their names and values may appear if the child emits them. A key whose name contains, case-insensitively,
`token|secret|password|credential|api[_-]?key|private[_-]?key` is forbidden in `inherit` and `variables` and must be supplied
through `secrets` instead.

`secrets` contains credential values, which are copied only for the invocation and registered before spawn with the output
port's streaming redaction capability. The output port alone constructs independent stdout, stderr, and protocol redaction
fronts and their bounded raw destinations. Raw child bytes MUST NOT reach a parser, evidence object, fault, result, event, or
callback before the applicable redaction front. Duplicate keys across `inherit`, `variables`, and `secrets`, an empty secret value, an invalid key,
or any environment bound violation fails preflight with `revo.agent.environment_invalid`. Definitions contain no
credentials; the consumer owns credential storage and selection. Environment keys MUST match
`^[A-Za-z_][A-Za-z0-9_]*$`; repeated names within one collection also count as duplicates.

Streaming redaction MUST detect secret values split across stdout, stderr, or protocol chunks. The protocol destination is
bound exactly once after resource finalization; it buffers no bytes before binding. Unredacted carry buffers and secret copies
are discarded after finalization. Secret values never enter definition digests, events, results, output files, or
process-local completed records. No confidentiality promise applies to `inherit` or `variables`.

On every supported local invocation cell, the manager launches the invocation in a separate process group with piped stdin,
stdout, and stderr and keeps process output unpumped. One
`activeStateOperationTimeoutMs` deadline bounds the complete post-spawn inspect, fingerprint, and initial `save` sequence. It
inspects the new child immediately, captures the package fingerprint and application `startedAt`, and calls
`activeStateSink.save({ invocationId, pin, state: 'running', process }, context)` with the remaining deadline. The active
snapshot MUST be saved before atomic acceptance and handle creation. After acceptance, the sole registered coordinator
receives the authentic live and I/O authorities and activates stdout, stderr, and protocol I/O exactly once. The activation is
outside the active-state setup window and MUST NOT extend, reset, or consume it. A timeout or unavailable identity fails with
`revo.agent.process_identity_failed`; a failed/timed-out sink save fails with `revo.agent.active_state_failed`. In both
cases the runtime first kills and reaps the live child/process group through its private live-owned capability, then rejects
`start()`. A rejected or timed-out initial save is maybe-persisted: after confirmed reap the manager waits for a still
unsettled, already-dispatched save to fulfil after abort in the bounded quiescence window, then attempts absent-row-safe
idempotent `remove` before releasing its private guard/reservation. A rejected save cannot provide that fulfilment, so its
quiescence is unknown and it receives no `remove`. Only a fulfilled `remove` releases the guard as allowed. Unknown
quiescence, rejected removal, or uncertain removal keeps the reservation unavailable, leaves the manager failed-closed, and
requires a fresh manager to reconcile
consumer-loaded rows. Without cancellation, the rejected/timed initial save keeps primary
`revo.agent.active_state_failed`; its bounded redacted detail records quiescence or reconciliation uncertainty and MUST NOT
imply confirmed cleanup. If identity capture cleanup cannot be confirmed, its primary fault remains
`revo.agent.process_identity_failed` with bounded cleanup-uncertain detail. The manager retains the private owned-child
guard/reservation, becomes permanently failed-closed, and retries bounded cleanup during shutdown. Continuing uncertainty
rejects shutdown with `revo.agent.shutdown_failed`; the consumer MUST externally resolve the supervision domain. An
unsupported invocation cell fails during preclaim platform admission and does not claim output or spawn; there is no separate
non-recovery start path.

The invocation wall-clock deadline begins when process spawn succeeds, before identity inspection and active-state save. It
does not begin at preflight, logical acceptance, or handle return. Post-spawn setup therefore consumes invocation wall-clock
budget as well as its shorter active-state operation budget.

Cancellation before a child is spawned performs no sink call or process signal and rejects the still pre-acceptance
`start()`. Cancellation after spawn but before initial save dispatch uses the live child handle to kill and reap, writes no
snapshot, and rejects after confirmed cleanup. Cancellation after dispatch treats the `running` save as maybe-persisted and,
after confirmed reap, requires a still-unsettled save's post-abort fulfilment within the quiescence window and a fulfilled
removal before releasing the guard. A rejected save leaves quiescence unknown and receives no removal. An unconfirmed reap
rejects with primary `revo.agent.process_cleanup_failed` plus bounded cancellation
cause and retains the private owned-child
guard/reservation. Neither pre-running path returns a handle or creates a public invocation. The usual
save-before-acceptance-and-handle requirement applies to invocations that reach `running`.
`running | cancelling` in `ActiveInvocationSnapshot` describes
persisted process supervision only; it is distinct from the broader `AgentInvocationStatus` state machine.

Failures before acceptance reject `start()` with `AgentManagerError` and no handle. This includes spawn failure, confirmed
post-spawn process-identity or initial active-state-save cleanup, and confirmed pre-acceptance cancellation. None may create
a handle, event, completed record, result, retention entry, or signal authority from persisted row data. The C1/U1 exceptions
remain private: unconfirmed reap retains its owned-child guard/reservation, while a maybe-persisted initial save with unknown
quiescence or rejected/uncertain remove retains a reconciliation guard/reservation and fails the manager closed. After a
`running` snapshot has been saved and the invocation has been atomically accepted, later process, protocol, activation,
timeout, cancellation, output, result parsing, and result validation failures follow the accepted terminal arbiter and typed
terminal-result rule; `result()` never rejects for an invocation failure.

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
allowed. Cancellation, deadline, process/protocol, cleanup, and finalization candidates arbitrate through one atomic terminal
commit: the first candidate to commit determines the immutable terminal result; later candidates cannot replace it. The
specification intentionally does not infer a priority from arrival order before that commit.

The state machine begins at atomic Option A acceptance and handle creation while process I/O is still paused. Sole-coordinator
registration and one-use I/O activation are postacceptance operations and cannot retroactively reject `start()`. A terminal
candidate observed after acceptance uses the accepted terminal arbiter even when activation is skipped or fails. Private
preacceptance drain registration and a rejected pending start are not `accepted`, `starting`, `cancelling`, terminal, or
retained states and are not observable through this state machine.

Only `running` and `cancelling` have consumer-backed active snapshots, and only on supported local POSIX platforms. These are
process-supervision states, not a persisted copy of `AgentInvocationStatus`. For an invocation with a saved `running` row,
the manager starts a best-effort save of the same process identity as `cancelling` but does not await that save, its timeout,
or its eventual quiescence before provider dispatch or the first local cancellation signal. A rejected or timed-out save emits
bounded diagnostic `revo.agent.active_state_save_failed` but does not prevent the manager from using its live owned child
handle to terminate and reap the process group. After confirmed termination it attempts `remove`; a stale `running` row left
by a database outage is safe for the next initialization to remove once the PID is definitely absent. Cancellation and shutdown
do not require host termination solely because active-state persistence failed when process-group termination and reap were
confirmed.

Natural leader exit is not yet process-group completion. Before removing the active snapshot or finalizing a result, the
manager checks its live owned process group for descendants, sends group `SIGTERM`, performs the bounded wait and `SIGKILL`
escalation when needed, and confirms the entire group is gone. If group cleanup cannot be confirmed, the manager preserves
the active row, emits typed bounded `revo.agent.process_cleanup_failed`, and keeps the invocation nonterminal. A later
successful shutdown cleanup may then remove the row and finalize the invocation as failed with that fault; continued
uncertainty produces `shutdown_failed` and no false terminal result.

After confirmed process-group termination, the manager calls `activeStateSink.remove(invocationId, context)` before result
collection/finalization continues. Removal does not wait for or store a result. One rejected or timed-out removal leaves the
stale consumer row for later initialization and MUST NOT replace or mutate the invocation's terminal result. It is bounded
redacted technical evidence, not a public event payload. Active snapshots have no terminal, completed, or pending-ack state.

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

interface AgentLaunchEvidence {
  readonly executable: string;
  readonly reportedVersion: string;
}

interface AgentInvocationResultBase {
  readonly schemaVersion: 'agent-invocation-result/v1';
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  readonly launch: AgentLaunchEvidence;
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

The private parser preserves exactly `response_empty`, `response_too_large`, `invalid_utf8`, `invalid_json`,
`response_not_object`, `frame_malformed`, `frame_overflow`, `duplicate_terminal`, and `missing_terminal`, and maps them to the
existing public fault codes without changing this public type surface. The
[private execution-handoff specification](./execution-handoff.spec.md) owns the exact mapping.

Only result extraction, strict UTF-8/JSON/top-level-object parsing, or result-schema validation failure may carry and publish
eligible bounded redacted raw evidence under ADR-0003. Frame, transport, process, timeout, cancellation, output, cleanup, and
internal failures MUST NOT carry or publish it. When eligible failure reaches raw publication, `response_empty` and
`missing_terminal` publish a zero-byte `raw-final-response.txt`; `duplicate_terminal` uses the second complete terminal
candidate. Raw publication is non-replacing and is distinct from non-replacing `result.json` publication. No successful
unstructured-text result exists.

## 7. Errors

```ts
type AgentFaultCode =
  | 'revo.agent.definition_invalid'
  | 'revo.agent.definition_duplicate'
  | 'revo.agent.strategy_unsupported'
  | 'revo.agent.manager_not_initialized'
  | 'revo.agent.manager_closed'
  | 'revo.agent.shutdown_failed'
  | 'revo.agent.recovery_invalid'
  | 'revo.agent.recovery_failed'
  | 'revo.agent.active_state_failed'
  | 'revo.agent.process_identity_failed'
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
  | 'revo.agent.platform_unsupported'
  | 'revo.agent.spawn_failed'
  | 'revo.agent.process_failed'
  | 'revo.agent.process_cleanup_failed'
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
    | 'initializing'
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
guarantee. Launch evidence contains only the resolved absolute executable path and strict-SemVer version; faults do not expose
command arguments, environment, prompts, credentials, fingerprints, or provider output. JSON Schema diagnostics use JSON
Pointer paths and bounded messages.

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
  | (AgentEventBase & { readonly type: 'invocation.cancelling' })
  | (AgentEventBase & { readonly type: 'invocation.finished' });

interface AgentEventFilter {
  readonly invocationId?: string;
  readonly agent?: AgentRef;
  readonly types?: readonly AgentEvent['type'][];
}

type Unsubscribe = () => void;
type AgentEventListener = (event: AgentEvent) => void;
```

`subscribe(filter, listener)` observes all matching future lifecycle events. `{}` observes every invocation; `{ invocationId }`
observes one. Delivery is ordered per invocation by strictly increasing `sequence`. Listener failure is isolated and MUST NOT
change invocation outcome; it is not re-emitted as a public diagnostic event. Delivery is synchronous after the applicable
internal recording attempt; a slow listener applies consumer-side latency but cannot create an unbounded package queue. V1
does not expose `AsyncIterable`, an internal listener queue, a listener-worker pool, or a numeric event-fanout limit. V1 also
defines no active-invocation admission limit or internal admission queue. The consumer owns admission, concurrency, listener
execution cost, downstream buffering, fanout, and backpressure.

Every accepted invocation delivers exactly one process-local `invocation.finished` while the manager process remains alive.
Before delivery, the manager MUST make the completed record visible to `getResult`. The terminal event signals result
availability; it does not carry the result or file manifest. Filesystem recording is best-effort only after a late I/O failure
and does not weaken process-local terminal delivery.

| Surface                                 | Carries                                                                                                                                                              | Must not carry                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public subscription and `events.ndjson` | The lifecycle type, invocation id, pin, sequence, and timestamp. `invocation.finished` signals that `getResult` is ready.                                            | Output bytes, stream names, diagnostics, cancellation text, raw responses, result objects, faults, or file manifests. |
| Handle and manager result APIs          | The immutable bounded redacted `AgentInvocationResult`, including typed terminal fault, raw-response diagnostic when applicable, launch evidence, and file manifest. | Live unbounded streams or an unredacted provider response.                                                            |
| Reserved output files                   | Bounded redacted stdout, stderr, lifecycle NDJSON, failure-only raw response, and atomically published normalized result.                                            | A second public event payload or consumer-owned retention/indexing state.                                             |

The same matrix applies to every adapter. A terminal result remains available through `result()`, `getResult`, and
`waitForResult`; event delivery is never a result transport.

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
  initialize(snapshots: readonly ActiveInvocationSnapshot[]): Promise<void>;
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

Except for `listAgents`, `getAgent`, the first `initialize` call, and `shutdown`, manager methods require successful
initialization. Calls made before the shared initialization fulfills fail with `revo.agent.manager_not_initialized`. After
initialization rejects, the manager remains failed-closed and those operations fail with `revo.agent.manager_closed`.

`getResult` is non-throwing and distinguishes running, retained completed, and unknown. `waitForResult` immediately returns
a retained completed result, waits for an active invocation, and rejects an unknown id with
`revo.agent.invocation_unknown`. Handle `result()` follows the same rule for its accepted invocation and never rejects for
an execution failure.

`listInvocations()` returns active and retained completed snapshots only. Terminal filters provide the completed list; no
separate `completedRuns` collection exists. Results are ordered by `acceptedAt`, then `invocationId`.

Cancellation is idempotent. Unknown returns `unknown`; retained completion returns `already_completed`; active work returns
`requested` after cancellation is committed. Saving `cancelling` is best-effort and non-blocking. For caller cancellation,
deadline expiry, and shutdown, an adapter with `capabilities.cancellation: true` MAY dispatch its provider graceful-
cancellation hook best-effort without awaiting acknowledgement or completion. A `false` capability, unavailable hook, or hook
failure enters the identical local path. Cancellation reason is bounded and redacted.
Termination uses the live owned child handle for normal in-memory invocations. Recovered processes require a fresh matching
fingerprint before any signal; a persisted PID or process-group id alone is never authority. For supported local POSIX
cleanup, the manager sends `SIGTERM` to the live-authorized invocation process group, waits at most 2,000 ms, sends group
`SIGKILL` only if the group remains live, and confirms group termination and leader reap. Active-state operation deadlines do
not shorten or extend this grace interval. Timeout, cancellation, initialization cleanup, natural-exit descendant sweep, and
shutdown share this POSIX escalation and confirmation contract. Provider graceful-cancellation dispatch applies only to
caller cancellation, deadline expiry, and shutdown; it is not implied by natural exit or recovery. V1 defines no persisted
recovery or process-group contract for other platforms.

`shutdown(reason?)` closes the manager's process-local supervision domain. It is idempotent and concurrency-safe: the first
call atomically marks the manager closing and creates one shared completion promise. Concurrent and later calls return that
completion and observe its same fulfillment or rejection. The first call's copied, bounded, redacted reason is authoritative;
reasons on later calls are ignored.

Shutdown is available before readiness. If initialization was never called, shutdown closes the manager and resolves with no
active work. If initialization is pending, shutdown atomically closes new work, aborts the current abortable recovery
operation, starts no further rows, and waits only until the existing `initializationTimeoutMs` deadline. Every recovery
process already signalled must still have termination confirmed. Deadline expiry or uncertain cleanup rejects the shared
shutdown with `revo.agent.shutdown_failed`; shutdown never waits indefinitely. An `initialize` call after closing rejects
with `revo.agent.manager_closed`.

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

Shutdown applies the same 4 KiB bound and redaction rules as cancellation reasons. It cancels and drains every
preregistered claim attempt, output-preparation attempt, process-start attempt, spawn-accepted paused-I/O start,
running/accepted invocation, version probe, active-state lane, terminal publication authority, retained claim guard, and
retained cleanup authority. An attempt registered before close is included even when its syscall or first mutation has not
yet dispatched.

Independent items drain concurrently under their applicable operation-owned public or fixed private bounds.
`initializationTimeoutMs` bounds initialization only: shutdown interrupting initialization uses that initialization's existing
remaining deadline, starts no further recovery rows, and still confirms every recovery process already signalled. It is not a
general shutdown deadline and does not shorten or extend another operation's bound.

Successful shutdown requires confirmed absence and reap of every live-owned invocation and probe process, every accepted
invocation at terminal process-local completion, and output quiescence for every claimed invocation. A retained claim or
cleanup owner that remains unresolved after its bounded drainage rejects the shared shutdown completion with
`revo.agent.shutdown_failed`. An accepted invocation with uncertain cleanup remains active and nonterminal. A rejected
preacceptance start with retained authority remains publicly unknown and its id remains unavailable. Invocation execution or
finalization failures do not by themselves reject shutdown; they remain typed invocation results.

If saving `cancelling` fails during shutdown, the manager emits bounded diagnostic evidence and still terminates and reaps
through authentic live authority. Confirmed process termination permits shutdown to continue and triggers a bounded `remove`
attempt. A failed active-row removal after confirmed group termination remains diagnostic-only and does not mutate the
invocation result.

Shutdown does not run an independent completed-record clear or eviction pass. Completions produced while draining enter the
normal bounded FIFO and MAY evict older completed records. An invocation handle retains its resolved terminal result even if
that completed record is later evicted. Shutdown never deletes consumer output directories, and consumer-supplied restart
cleanup occurs only during initialization.

A shutdown failure keeps the first idempotent shared settlement and the stable bounded, redacted, non-retryable
`revo.agent.shutdown_failed` fault; it MUST NOT replace an earlier invocation or rejected-start fault. The manager remains
permanently closed and failed closed, later shutdown calls observe the same rejection, and ordinary retained/active reads and
existing handles keep their documented semantics.

Replacement consequences depend on the unresolved authority. Unresolved manager-owned process cleanup prohibits a
replacement manager in the same supervision domain until external cleanup resolves. Output uncertainty quarantines only the
affected invocation id and path, extends the consumer's stable-ancestor warranty, and does not impose a global replacement
ban. Active-state uncertainty preserves the affected id and row for consumer-backed reconciliation by a fresh manager;
persisted identity remains correlation data and does not authorize the failed manager to continue.

## 10. Bounds, redaction, and retention

Execution limits become per-invocation defaults. An invocation may lower an execution value but cannot exceed it.
`activeStateOperationTimeoutMs` and `initializationTimeoutMs` are manager-only lifecycle limits. Values outside the minima,
hard maxima, or relational constraints fail construction or preflight as applicable.

| Configurable limit                | Minimum              | Default    | Hard maximum |
| --------------------------------- | -------------------- | ---------- | ------------ |
| Active-state operation timeout    | 100 ms               | 10 seconds | 30,000 ms    |
| Manager initialization timeout    | 1,000 ms             | 2 minutes  | 1,800,000 ms |
| Wall-clock timeout                | 1,000 ms             | 30 minutes | 1,800,000 ms |
| Idle timeout                      | 1,000 ms             | 5 minutes  | 300,000 ms   |
| One serialized non-terminal event | 1 KiB                | 64 KiB     | 64 KiB       |
| `events.ndjson`                   | Terminal reservation | 16 MiB     | 16 MiB       |
| `stdout.log`                      | 64 KiB               | 8 MiB      | 8 MiB        |
| `stderr.log`                      | 64 KiB               | 8 MiB      | 8 MiB        |
| Raw final response                | 64 KiB               | 1 MiB      | 1 MiB        |
| Retained completed records        | 1                    | 1,000      | 1,000        |

The active-state operation timeout MUST be less than or equal to the initialization timeout. The idle timeout MUST be less
than or equal to the wall-clock timeout. `maxEventsFileBytes` MUST be at least `terminalReservation`, where:

```text
terminalReservation = maxTerminalEventBytes + maxEventBytes + 2 newline bytes
maxTerminalEventBytes = 2 MiB
```

Fixed private policy values are not public manager options or invocation overrides:

| Fixed private value                  | Value     |
| ------------------------------------ | --------- |
| Output-claim operation timeout       | 10,000 ms |
| Output-preparation operation timeout | 10,000 ms |
| Duplex operation timeout             | 10,000 ms |
| Protocol frame                       | 1 MiB     |
| Accepted protocol frames             | 10,000    |
| Pending protocol writes              | 64        |
| Parser line                          | 1 MiB     |
| Parser carry                         | 1 MiB     |
| Cleanup reconcile timeout            | 500 ms    |
| Retained cleanup retries             | 2         |
| Process termination grace            | 2,000 ms  |
| Post-kill group/reap confirmation    | 500 ms    |
| Raw-response preview                 | 64 KiB    |
| Terminal lifecycle event             | 2 MiB     |
| Each version-probe stream            | 64 KiB    |

The non-terminal events budget is `maxEventsFileBytes - terminalReservation`. The reserved tail retains the existing byte
allocation for at most one bounded final non-terminal lifecycle event and one terminal lifecycle event. The terminal-event
bound remains fixed even though the event is no longer a result transport; no existing byte/file guarantee is weakened.

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
| Active snapshots per initialization | 1,000                    |
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

The idle deadline is terminal-only: it begins at native spawn acceptance and ends only when the invocation reaches a
committed terminal state. Stdout/stderr bytes, valid protocol frames, subscriber work, file flushes, and internal timers do
not reset or extend it. The wall-clock deadline also starts when process spawn succeeds, before post-spawn identity/save work
or handle return, and is authoritative even when an injected test clock stalls. If an idle or wall deadline races another
terminal candidate, section 5's first-commit arbitration applies.

Redaction runs before every subscriber delivery, result/fault construction, and file write. A configured secret is a
non-empty UTF-8 byte sequence and is matched as that exact literal byte sequence: it receives no normalization, decoding
substitution, or case folding. Every replacement is the exact literal `[REDACTED]`.

The built-in grammar is byte-oriented and has no escape parsing:

```text
KEY       = API_KEY | API_TOKEN | ACCESS_TOKEN | AUTH_TOKEN | CLIENT_SECRET | PASSWORD
KEY-VALUE = KEY OWS ("=" | ":") OWS (UNQUOTED | DQUOTED | SQUOTED)
UNQUOTED  = one or more bytes up to the first WSP, ",", ";", or "&"
DQUOTED   = '"' zero or more non-'"' bytes '"'
SQUOTED   = "'" zero or more non-"'" bytes "'"
HEADER    = (Authorization | Proxy-Authorization) OWS ":" OWS LINE-VALUE
BEARER    = "Bearer" WSP TOKEN
PEM       = complete bounded BEGIN delimiter, bytes, matching complete bounded END delimiter
```

`KEY`, `Authorization`, and `Proxy-Authorization` names compare ASCII case-insensitively; no other built-in token is case
insensitive. The complete `KEY` allowlist is `API_KEY`, `API_TOKEN`, `ACCESS_TOKEN`, `AUTH_TOKEN`, `CLIENT_SECRET`, and
`PASSWORD`; it does not use substring matching. Therefore `api_key` and `Client_Secret` match, while `TOKEN`, `SECRET`,
`CREDENTIAL`, `PASSWORD_HASH`, `X_API_KEY`, `API_KEY_ID`, and `CLIENT_SECRET_VALUE` do not match this built-in rule.
`OWS` is ASCII space or tab, `WSP` is one or more ASCII spaces or tabs, `LINE-VALUE` ends at CR or LF, and `TOKEN` ends at
WSP, comma, semicolon, ampersand, CR, or LF. A named header replaces its full value; a bare `Bearer` form replaces only its
following token. `KEY-VALUE` retains its key and separator but replaces the one value. `PEM` begins and ends only at complete
delimiters of at most 128 UTF-8 bytes in the form `-----BEGIN <LABEL> PRIVATE KEY-----` and
`-----END <same LABEL> PRIVATE KEY-----`, where `<LABEL>` contains only uppercase ASCII letters, digits, and spaces. It
replaces the complete block. Incomplete delimiters are not PEM matches.

Redaction state is independent for `stdout`, `stderr`, and protocol. In normal state, the matcher selects the leftmost
candidate and, at one start offset, the longest candidate; an exact literal and a built-in form use that same overlap rule.
It emits only bytes that cannot begin a later match and keeps at most 64 KiB of undecided UTF-8 candidate bytes per channel.
For a complete candidate, it emits the permitted structural prefix, exactly one `[REDACTED]`, and any safe delimiter that is
not part of the value.

If a malformed or unterminated built-in candidate would exceed that 64 KiB carry limit, the channel emits exactly one
`[REDACTED]`, enters discard-until-delimiter state, and discards every candidate byte without writing it to any sink. For an
unquoted key value or bare Bearer token, a safe delimiter is WSP, comma, semicolon, ampersand, CR, or LF; for a quoted value,
it is the matching quote; for a named header, it is CR or LF; for PEM, it is the matching complete END delimiter. The safe
delimiter ends discard state and normal matching resumes after it. At channel end, discard state clears without another marker.
This overflow transition neither persists a candidate tail nor fails the invocation.

At final flush, a remaining candidate within the carry limit is emitted as its permitted structural prefix plus exactly one
`[REDACTED]`; a discard-state channel emits no additional marker. Finalization then best-effort clears mutable carry buffers
and invocation secret copies. No unredacted carry or secret copy may survive finalization. Truncation is explicit:

- stdout and stderr end with one bounded truncation marker within their file limit;
- the events recorder reserves one terminal-event slot for `invocation.finished`, records lifecycle-only events, and
  suppresses later non-terminal lifecycle events when its budget is exhausted;
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
`AgentInvocationResult`. Eligible `raw-final-response.txt` and `result.json` are separate non-replacing publications. Each
uses a same-directory manager-owned temporary file opened with exclusive creation, write and file flush, a non-replacing
publish step, supported directory flush, and cleanup of the manager-owned temporary path. Existing destinations, unavailable
required semantics, or another publication failure fail closed; the manager never replaces committed evidence.

Terminal process-local completion proceeds in this exact order:

1. confirm natural-exit or cancellation process-group cleanup and leader reap;
2. attempt active-row removal;
3. normalize the confirmed duplex observation without reparsing;
4. attempt scratch cleanup;
5. flush bounded redacted stdout, stderr, and pending nonterminal lifecycle evidence;
6. replace the provisional outcome with `revo.agent.scratch_cleanup_failed` when scratch cleanup failed;
7. otherwise replace the provisional outcome with `revo.agent.output_write_failed` when an earlier pre-result evidence
   operation failed;
8. publish a failure-only raw response whenever normalization supplied authentic ADR-0003 eligibility, including a zero-byte
   file for `response_empty` or `missing_terminal`;
9. if raw publication fails, replace the provisional outcome with `revo.agent.output_write_failed` and omit the raw filename;
10. construct the bounded terminal result and include the raw filename only after successful raw publication;
11. publish that result to `result.json` without replacement;
12. if result publication fails, create the same bounded in-memory `revo.agent.output_write_failed` result with
    `files.result` absent and do not recursively retry result persistence;
13. add the immutable in-memory completed record and apply FIFO eviction;
14. best-effort append and flush exactly one lifecycle-only `invocation.finished` line;
15. retain bounded technical evidence when that append fails without mutating the committed result;
16. deliver exactly one process-local lifecycle-only `invocation.finished`; and
17. resolve handle and manager waiters.

Cleanup confirmation is a prerequisite to terminal commit. Scratch cleanup takes precedence over another provisional
execution/result fault; an earlier pre-result output failure takes precedence only when scratch cleanup succeeded. Terminal
NDJSON failure never replaces or mutates the in-memory result, and late output failure never strands process-local completion.

Exactly-one terminal delivery is a process-local invariant, not a promise that the terminal line reached the filesystem.
A handler receiving it MUST observe `{ state: 'completed', result }` from `getResult(invocationId)`. `result.json` may be
absent only when its atomic commit failed; its absence, or a missing terminal NDJSON record, is an incomplete audit record
for consumer recovery. Neither condition prevents the live manager from exposing the terminal result. A process crash is
outside the process-local exactly-once guarantee.

## 12. Consumer example

```ts
const manager = createAgentManager({
  definitions: [codexDefinition],
  activeStateSink: {
    save: (snapshot, context) => activeInvocationRepository.save(snapshot, context),
    remove: (invocationId, context) => activeInvocationRepository.remove(invocationId, context),
  },
});

const activeSnapshots = await activeInvocationRepository.listForLocalManager();
await manager.initialize(activeSnapshots);

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
- runtime-owned database reads, durable result/history storage, claims, leases, locks, host ids, or directory scanning;
- reconnection to native CLI or ACP-over-stdio invocations after manager restart;
- reconnectable ACP socket/daemon transport;
- package-owned run, step, attempt, retry, pipeline, or scheduling concepts;
- async iterators, replayable subscriber cursors, or cross-process fan-in;
- hostile or mutating output-ancestor support beyond the consumer-warranted stable-ancestor policy; such support requires a
  separate native capability design and supported-filesystem evidence;
- supported platform/filesystem cells, Windows process-tree/recovery behavior, CI evidence, and provider-version/wire
  conformance; unsupported cells are not implementation successes;
- process pooling or ACP session reuse across invocations;
- consumer-defined protocol, parser, or permission strategy injection;
- text-success results.
