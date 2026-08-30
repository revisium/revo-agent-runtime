# B+ execution preparation, duplex supervision, and terminal publication specification

- Status: Accepted
- Version: 1.0.0
- Accepted: 2026-08-19
- Implementation: Implemented behind the provider-neutral root API
- Target: private contracts of `@revisium/revo-agent-runtime`
- Architecture decision: B+ sealed intent, preregistered claim authority, attested resources, and one-use execution consume
- Related decision: [ADR-0013](../adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md)

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, REQUIRED, and OPTIONAL in this document are to be interpreted as described in RFC 2119 and BCP 14.

This document specifies implemented package-private behavior. Implemented source and tests remain the exact truth; this
status does not claim another provider or a supported platform/filesystem cell.

The [AgentManager v1 specification](../specs/agent-manager-v1.spec.md) exclusively owns the target public API. This B+ specification refines only package-private implementation contracts and MUST NOT add, remove, rename, or reinterpret a public field, fault, lifecycle state, or support claim.

## 1. Scope

This specification defines:

- the package-private handoff from a complete invocation request and one exact sealed definition to direct process spawn;
- exact binding of definition, protocol driver, result parser, permission strategy, and delivery modes;
- deterministic preclaim validation;
- preregistered output-claim ownership, bounded timeout, late settlement, and retained reconciliation;
- claimed scratch/evidence resource preparation;
- private one-use transfer of environment, argv, protocol material, and output capabilities;
- direct duplex process supervision and terminal coordination;
- parser failure taxonomy and evidence preservation;
- active-state, acceptance, cancellation, deadline, shutdown, cleanup, result normalization, and terminal publication ordering; and
- compatibility requirements for the current private execution and output ports.

This specification does not define consumer execution-plan persistence, scheduling, retry, workflow state, output-path construction, retention, database integration, provider selection, provider wire compatibility, public package export, package publication, or deployment.

The package MUST remain invocation-scoped. The consumer MUST continue to own admission, concurrency, invocation IDs, exact agent selection, workspaces, credentials, output hierarchy provisioning, durable active-row storage/loading, durable result indexing, retry, workflow transitions, and retention.

## 2. Terms and carrier phases

The terms below are normative.

1. **Invocation snapshot** is the complete defensive package-owned copy of the public start request and ephemeral start context values needed before spawn.
2. **Prepared invocation** is the authentic immutable preclaim carrier that proves every resource-independent decision has completed.
3. **Output resource plan** is the authentic read-only result of output-path admission and fixed resource-slot planning.
4. **Output claim attempt** is the preregistered authentic capability whose settlement, quiescence, cancellation, and deadline exist before the exclusive-create syscall may be dispatched.
5. **Claimed output session** is the authentic authority over one newly created output leaf and only the manager-owned objects inside that leaf.
6. **Prepared invocation resources** are the authentic attestations and one-use stream/resource capabilities created inside a claimed session.
7. **Terminal publication authority** is the authentic capability retained outside the process carrier for lifecycle NDJSON, failure-only raw-response publication, terminal result publication, scratch cleanup, and filesystem quiescence.
8. **Prepared execution** is the authentic one-use carrier created by mechanically binding one prepared invocation, one prepared resource set, and one prepared security capability.
9. **Process start attempt** is the preregistered authentic capability that owns spawn settlement, post-spawn cancellation/deadlines, live authority, and quiescence before native spawn dispatch.
10. **Paused process I/O** is the authentic post-spawn state in which OS pipe handles exist but no package stdout/stderr pump or callback is installed.
11. **Running execution** is the authentic duplex session entered only after acceptance and one successful I/O activation.
12. **Retained claim guard** is the authentic capability that remains attached to a dispatched claim whose timely outcome or quiescence is unknown.
13. **Retained cleanup authority** is the authentic capability that remains attached to a live-owned process whose group absence and leader reap are not confirmed.
14. **Acceptance** is the single transition that creates the public invocation and its handle after process identity and the initial `running` active-state save have succeeded, while process I/O remains paused.
15. **Terminal commit** is the single process-local transition that makes an immutable accepted-invocation result available.
16. **Terminal filesystem quiescence** means no package filesystem operation for the start remains pending, or every unresolved operation is owned by an authentic retained guard that keeps the manager failed closed and extends the consumer warranty.

The phase order MUST be:

```text
snapshot
  -> deterministic preclaim preparation
  -> prepared invocation + output resource plan
  -> preregistered output claim attempt
  -> claimed output session
  -> preregistered output-preparation attempt + terminal publication authority
  -> prepared resources
  -> prepared execution
  -> preregistered process start attempt
  -> spawn accepted with paused process I/O
  -> identity + initial `running` active-state save
  -> accepted invocation + handle creation
  -> sole coordinator registration + I/O activation
  -> running execution or postacceptance terminal drain
  -> confirmed terminal observation
  -> terminal publication and process-local commit
```

No later carrier MAY be constructed from a structural clone of an earlier carrier.

Every authority-bearing carrier MUST use an ECMAScript private-field brand and an unobservable per-invocation token.

`instanceof`, TypeScript `private`, a public symbol, a string tag, frozen visible fields, a digest, or structural equality MUST NOT grant authority.

## 3. Affected public input contract

The public target request remains provider-neutral and MUST contain these affected fields:

```ts
interface StartAgentInvocation {
  readonly invocationId: string;
  readonly agent: { readonly id: string; readonly version: string };
  readonly prompt: string;
  readonly workspace: { readonly directory: string };
  readonly parameters: JsonObject;
  readonly permissions: JsonObject;
  readonly metadata?: JsonObject;
  readonly result: { readonly schema: JsonSchema202012 };
  readonly limits?: {
    readonly wallClockTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxEventBytes?: number;
    readonly maxEventsFileBytes?: number;
    readonly maxStdoutBytes?: number;
    readonly maxStderrBytes?: number;
    readonly maxRawResponseBytes?: number;
  };
  readonly output: { readonly directory: string };
}

interface AgentStartContext {
  readonly signal?: AbortSignal;
  readonly environment?: {
    readonly inherit?: readonly string[];
    readonly variables?: Readonly<Record<string, string>>;
    readonly secrets?: Readonly<Record<string, string>>;
  };
}
```

The complete affected manager limit surface MUST be:

```ts
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
```

`activeStateOperationTimeoutMs` and `initializationTimeoutMs` MUST be manager-only lifecycle limits.

An invocation MAY lower an invocation-scoped manager default.

An invocation MUST NOT raise an invocation-scoped manager default.

The private output-claim, output-preparation, duplex-operation, protocol-frame, accepted-frame-count, and pending-write bounds MUST NOT be public configuration.

The package MUST defensively copy every durable string, array, record, JSON object, schema, and limit before retaining it.

The package MUST retain the caller's `AbortSignal` only as an ephemeral cancellation input.

The package MUST reject accessor-backed, sparse, cyclic, non-plain, non-finite, invalid-Unicode, unknown-key, or out-of-bound input before output claim.

## 4. Definition and installed-binding contract

Definition code MUST own defaults overlay, effective-value schema validation, defensive JSON copying, RFC 8785 canonicalization, and consumer-schema compilation.

Definition code MUST NOT depend on execution code.

Execution code MUST own provider-neutral ports, authentic carriers, resource finalization, terminal coordination, normalization, and deadline contracts.

Execution code MUST NOT depend on definition implementations, application composition, concrete strategies, or platform implementations.

Application MUST be the only composition root that may import definition, execution, strategies, platform ports, and the sealed registry together.

Strategies and platform implementations MUST implement execution-owned ports and MUST NOT import application code.

The exact sealed definition supplies these execution selectors:

```ts
type ProtocolDriverId = 'native/stdio-v1' | 'acp/v1';
type ResultParserId = 'codex-jsonl/v1' | 'claude-stream-json/v1';
type PermissionStrategyId = 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';

type PromptDelivery = 'argument' | 'stdin' | 'file' | 'protocol';
type ResultSchemaDelivery = 'argument' | 'file' | 'protocol';
type ResultDelivery = 'stdout' | 'protocol';

interface ExecutionBinding {
  readonly protocolDriverId: ProtocolDriverId;
  readonly resultParserId?: ResultParserId;
  readonly permissionStrategyId: PermissionStrategyId;
  readonly delivery: {
    readonly prompt: PromptDelivery;
    readonly resultSchema: ResultSchemaDelivery;
    readonly result: ResultDelivery;
  };
  readonly cancellationSupported: boolean;
}

type PermissionMappingResult =
  | Readonly<{ status: 'mapped'; arguments: readonly string[] }>
  | Readonly<{ status: 'omitted' }>
  | Readonly<{
      status: 'rejected';
      reason: 'permission_missing' | 'permission_invalid' | 'permission_denied';
    }>;

interface PermissionStrategyPort {
  readonly id: PermissionStrategyId;
  map(
    request: Readonly<{
      item: Extract<AgentArgumentTemplate, Readonly<{ kind: 'permission' }>>;
      effectivePermissions: JsonObject;
    }>,
  ): PermissionMappingResult;
}
```

Application composition MUST own closed installed maps from each ID to its package implementation.

The generic execution adapter MUST NOT select a binding by agent ID or provider name.

The accepted coherence matrix MUST be:

| Driver            | Parser                  | Permission      | Prompt delivery                | Schema delivery      | Result delivery |
| ----------------- | ----------------------- | --------------- | ------------------------------ | -------------------- | --------------- |
| `native/stdio-v1` | `codex-jsonl/v1`        | `codex-cli/v1`  | `argument`, `stdin`, or `file` | `argument` or `file` | `stdout`        |
| `native/stdio-v1` | `claude-stream-json/v1` | `claude-cli/v1` | `argument`, `stdin`, or `file` | `argument` or `file` | `stdout`        |
| `acp/v1`          | absent                  | `acp/v1`        | `protocol`                     | `protocol`           | `protocol`      |

Manager construction MUST reject an incoherent tuple.

Manager construction MUST reject a coherent tuple when any selected implementation is not installed.

Construction rejection MUST use `revo.agent.strategy_unsupported`.

Preclaim MUST repeat exact installed-identity and coherence checks as defense in depth.

A preclaim disagreement with construction MUST use `revo.agent.internal` and MUST occur before output mutation.

The exact agent ID, version, definition digest, binding IDs, and delivery tuple MUST be bound into one unobservable per-invocation token.

The registry MUST be read exactly once for the invocation.

Execution MUST NOT reread the registry or receive the full definition.

Permission mapping MUST execute exactly once before claim.

Permission mapping MUST receive only the current permission template item and the effective permissions object.

Permission mapping MUST NOT inspect the registry, filesystem, environment, workspace, prompt, result schema, or output path.

## 5. Deterministic preclaim preparation

Before output claim, the package MUST complete every validation and transformation that does not require a newly claimed filesystem object.

The required preclaim operations are:

1. manager initialization and close-state check;
2. complete defensive snapshot;
3. invocation-ID reservation across pending, active, and retained-completed records;
4. one exact sealed-registry lookup;
5. installed-binding lookup and coherence validation;
6. shallow parameter and permission default overlay;
7. effective parameter and permission schema validation;
8. package-owned canonical copies of effective values;
9. result-schema profile validation, RFC 8785 canonicalization, and compilation;
10. application adaptation of the compiled schema to the execution-owned result validator at diagnostic root `/result`;
11. explicit child-environment capture from a named host snapshot;
12. authentic secret registration from configured secrets and invocation secrets;
13. required workspace admission;
14. read-only output-path admission and fixed resource-slot planning;
15. permission mapping and complete template interpretation;
16. prompt, schema, stdin, and protocol payload preparation;
17. prospective argument, payload, environment, protocol, and secret-leak bounds;
18. fresh executable resolution and version proof.

Defaults MUST use top-level replacement and MUST NOT recursively merge.

Parameter rendering MUST emit strings unchanged.

Parameter rendering MUST emit finite numbers, booleans, null, objects, and arrays as RFC 8785 JSON text.

Every template item MUST be interpreted once in definition order.

A file-delivery template MUST produce only a resource slot before claim.

A resource slot MUST resolve only to the exact path fixed by the output resource plan.

The final command MUST use the freshly proved absolute executable path.

The command MUST be invoked without a shell.

The prospective argument check MUST include the executable in the total UTF-8 byte count.

The package MUST reject an exact registered-secret byte substring in prospective argv or a prospective scratch payload with existing fault `revo.agent.environment_invalid`.

No built-in output-redaction grammar MAY be used to scan deterministic inputs. The exact registered-secret substring check applies only to prospective argv and prospective scratch payloads.

No deterministic caller, definition, binding, permission, environment, workspace, schema, platform, probe, argument, or prospective bounds failure MAY first occur after output claim.

## 6. Prepared invocation and security capability

`PreparedInvocation` MUST expose only:

```ts
interface PreparedInvocationView {
  readonly invocationId: string;
  readonly pin: {
    readonly agentId: string;
    readonly agentVersion: string;
    readonly definitionDigest: string;
  };
  readonly workspaceDirectory: string;
  readonly outputDirectory: string;
  readonly reportedVersion: string;
  readonly binding: ExecutionBinding;
}
```

`PreparedInvocation` MUST privately own two disjoint one-use bundles:

- output-preparation material containing only fixed file slots, exact mutable payload bytes, expected lengths, and expected SHA-256 attestations; and
- finalization material containing the proved executable, cwd, argument atoms, stdin/protocol bytes, effective limits, selected driver/parser objects, result validator, and delivery tuple.

`PreparedInvocation` MUST NOT expose argv, environment, prompt bytes, schema bytes, secret values, secret registration, raw sinks, validator objects, cleanup authority, or process requests.

`registerSecrets` MUST remain the sole configured-plus-invocation registration path.

`registerSecrets` MUST return either an authentic `RegisteredSecrets` capability or a typed rejection.

`RegisteredSecrets` MUST expose no secret string, byte array, iterator, serializer, clone, spread helper, or caller callback.

Raw secret arrays MUST NOT be accepted by redaction consumers after migration.

`PreparedExecutionSecurity` MUST expose only `invocationId`.

`PreparedExecutionSecurity` MUST privately own the exact token, one one-use environment bundle, one disjoint one-use redaction-material bundle backed by the authentic registered-secrets capability, and disposal state.

The environment bundle MUST remain in `PreparedExecutionSecurity` until resource finalization. Its reference MUST be atomically removed from that source before transfer into `PreparedExecution`.

Before output preparation, the authorized redaction-material consume helper MUST authenticate the security capability and output-preparation attempt, copy the private redaction-material reference to a local, set the source field to `undefined`, mark that bundle consumed, and only then return an authentic `ConsumedRedactionMaterial`.

The redaction-material consume helper MUST NOT expose secret values or construct a stream or file sink.

`InvocationOutputPort` MUST be the sole owner that constructs the stdout, stderr, and protocol redaction front ends and their bounded raw destination sinks.

It MUST construct three distinct channels from one consumed authentic redaction-material bundle during claimed-output preparation. The protocol channel MUST be constructed with an authentic one-use deferred destination binding; output preparation MUST NOT construct a protocol session or invent a placeholder destination.

Each channel MUST have independent carry, truncation, end, and disposal state.

The raw destination sinks MUST remain private to the output adapter. Preparation MAY transfer only the three one-use redaction front ends and the protocol channel's matching deferred binding through `PreparedInvocationResources`; neither a raw destination sink nor secret registration MAY cross into the process adapter.

Raw child bytes MUST NOT reach a file, parser, event, result, fault, completed record, or consumer callback.

## 7. Output admission and claim ownership

Output admission MUST be read-only.

Output admission MUST validate a normalized absolute leaf path, an existing directory parent, and a currently absent leaf.

The fixed private file-delivery paths MUST be:

```text
<output.directory>/.scratch/prompt.txt
<output.directory>/.scratch/result-schema.json
```

The exclusive-create syscall MUST remain race-authoritative.

The consumer MUST warrant stable trusted output ancestors from preflight until terminal filesystem quiescence or external reconciliation of a retained guard.

The package MUST NOT create ancestors.

The package MUST NOT adopt, overwrite, rotate, suffix, or delete the output leaf.

The authority-bearing output carriers MUST expose exactly these informational fields:

```ts
interface OutputResourcePlan {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly needsPromptFile: boolean;
  readonly needsResultSchemaFile: boolean;
}

interface ClaimedInvocationOutput {
  readonly invocationId: string;
  readonly outputDirectory: string;
}

interface OutputClaimGuard {
  readonly invocationId: string;
  readonly outputDirectory: string;
}

interface PreparedInvocationResources {
  readonly invocationId: string;
  readonly outputDirectory: string;
}
```

Their visible fields MUST NOT authorize claim, preparation, publication, cleanup, retry, or spawn.

The exact claim contract MUST be:

```ts
type OutputClaimResult =
  | Readonly<{ status: 'claimed'; session: ClaimedInvocationOutput }>
  | Readonly<{
      status: 'rejected';
      reason:
        'cancelled_before_dispatch' | 'leaf_exists' | 'create_failed' | 'internal_before_dispatch';
    }>
  | Readonly<{
      status: 'uncertain';
      reason: 'claim_timeout' | 'claim_state_unknown';
      guard: OutputClaimGuard;
    }>;

type OutputClaimQuiescence =
  | Readonly<{ status: 'quiescent'; syscallDispatched: boolean }>
  | Readonly<{ status: 'retained'; guard: OutputClaimGuard }>;

interface OutputClaimAttempt {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly settlement: Promise<OutputClaimResult>;
  readonly quiescence: Promise<OutputClaimQuiescence>;
  requestCancellation(): void;
}
```

The claim-attempt factory MUST allocate both promises before it returns.

The claim-attempt factory MUST arm the fixed private 10-second one-shot claim deadline before it returns.

The claim-attempt factory MUST attach eventual platform settlement and quiescence continuations before it returns.

Application MUST synchronously insert the authentic attempt and both promises into shutdown drainage before calling `beginClaim`.

No await, event delivery, caller callback, or re-entrant boundary MAY occur between drain insertion and `beginClaim`.

`beginClaim` MUST be synchronous at its call boundary.

`beginClaim` MUST catch its own synchronous implementation failure and MUST NOT throw to application.

A synchronous failure before syscall dispatch MUST settle as `internal_before_dispatch` with quiescent undispatched state.

A synchronous failure after syscall dispatch MUST settle as `claim_state_unknown` with retained quiescence and the identical guard.

The filesystem adapter MUST authenticate the attempt before syscall dispatch.

Cancellation observed before dispatch MUST settle as `cancelled_before_dispatch` with quiescent undispatched state.

Cancellation after dispatch MUST NOT revoke or reinterpret the claim.

A fully settled and quiescent create result before the deadline MUST atomically fulfill both claim promises.

No consumer-visible claimed/rejected settlement MAY precede the matching quiescence settlement.

If the deadline wins after dispatch, settlement MUST be `uncertain/claim_timeout` and quiescence MUST be `retained`.

The uncertain settlement and retained quiescence MUST carry the same authentic guard by object identity.

A synchronous postdispatch state loss MUST settle as `uncertain/claim_state_unknown` with the same retained-guard rule.

The underlying syscall and adapter-quiescence continuations MUST remain attached to the retained guard after timeout.

A late successful create MUST become an authentic claimed session under that guard and MUST remain quarantined.

A late `EEXIST` or confirmed create failure MUST reconcile as absent manager ownership.

An unknowable late outcome MUST retain the guard, ID reservation, path reservation, stable-ancestor obligation, and failed-closed manager state.

Both claim promises MUST fulfill exactly once and MUST NOT reject.

## 8. Retained claim reconciliation

`OutputClaimGuard` MUST expose only `invocationId` and `outputDirectory`.

It MUST expose no resolver, retry, path mutation, or callable instance method.

Only execution-owned brand-checking helpers MAY operate on it.

The exact helper results MUST be:

```ts
type OutputClaimReconciliation =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'claimed'; session: ClaimedInvocationOutput }>
  | Readonly<{ status: 'unknown'; reason: 'pending' | 'unreconciled' | 'deadline' }>;

type OutputClaimGuardQuiescence =
  Readonly<{ status: 'quiescent' }> | Readonly<{ status: 'timed_out' }>;
```

Claim reconciliation MUST wait no longer than `cleanupReconcileTimeoutMs`.

Claim quiescence MUST wait no longer than the fixed private 10-second claim/quiescence bound.

Both helpers MUST fulfill their closed union and MUST NOT reject.

An `absent` result MAY release the path guard only after quiescence.

A `claimed` result MUST transfer the authentic session into rejected-start quarantine drainage.

An `unknown` or `timed_out` result MUST retain the guard and MUST keep the manager failed closed.

Shutdown MUST drain all retained claim guards concurrently under the fixed private claim and quiescence bounds. It MUST NOT use or extend `initializationTimeoutMs` for this drainage.

## 9. Claimed resources and terminal publication authority

The exact output result contracts MUST be:

```ts
interface OutputAdmissionRequest {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly needsPromptFile: boolean;
  readonly needsResultSchemaFile: boolean;
}

type OutputPathAdmission =
  | Readonly<{ status: 'admitted'; plan: OutputResourcePlan }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'invalid_path'
        | 'missing_parent'
        | 'parent_not_directory'
        | 'leaf_exists'
        | 'inspection_failed';
    }>;

interface ConsumedOutputPreparationMaterial {
  readonly invocationId: string;
  readonly outputDirectory: string;
}

interface ConsumedRedactionMaterial {
  readonly invocationId: string;
}

interface DeferredProtocolDestinationBinding {
  readonly invocationId: string;
}

interface TerminalPublicationAuthority {
  readonly invocationId: string;
  readonly outputDirectory: string;
}

type OutputPreparationResult =
  | Readonly<{
      status: 'prepared';
      resources: PreparedInvocationResources;
      authority: TerminalPublicationAuthority;
    }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_mutation'
        | 'scratch_conflict'
        | 'scratch_create_failed'
        | 'scratch_write_failed'
        | 'scratch_flush_failed'
        | 'redaction_sink_create_failed'
        | 'evidence_open_failed'
        | 'internal_before_mutation';
      authority: TerminalPublicationAuthority;
    }>
  | Readonly<{
      status: 'uncertain';
      reason: 'preparation_timeout' | 'preparation_state_unknown';
      authority: TerminalPublicationAuthority;
    }>;

type OutputPreparationQuiescence =
  | Readonly<{ status: 'quiescent'; mutationDispatched: boolean }>
  | Readonly<{
      status: 'retained';
      authority: TerminalPublicationAuthority;
    }>;

interface OutputPreparationAttempt {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly authority: TerminalPublicationAuthority;
  readonly settlement: Promise<OutputPreparationResult>;
  readonly quiescence: Promise<OutputPreparationQuiescence>;
  requestCancellation(): void;
}

type OutputAppendResult =
  | Readonly<{ status: 'appended' }>
  | Readonly<{ status: 'suppressed'; reason: 'nonterminal_budget_exhausted' }>
  | Readonly<{ status: 'failed'; reason: 'write_failed' | 'flush_failed' }>;

type RawResponsePublicationResult =
  | Readonly<{ status: 'published'; file: 'raw-final-response.txt' }>
  | Readonly<{
      status: 'failed';
      reason:
        'conflict' | 'write_failed' | 'flush_failed' | 'link_failed' | 'directory_flush_failed';
    }>;

type TerminalResultPublicationResult =
  | Readonly<{ status: 'published'; file: 'result.json' }>
  | Readonly<{
      status: 'failed';
      reason:
        'conflict' | 'write_failed' | 'flush_failed' | 'link_failed' | 'directory_flush_failed';
    }>;

type ScratchCleanupResult =
  | Readonly<{ status: 'cleaned' | 'absent' }>
  | Readonly<{ status: 'failed'; reason: 'cleanup_failed' }>;

type OutputQuiescenceResult = Readonly<{ status: 'quiescent' }> | Readonly<{ status: 'retained' }>;
```

`OutputResourcePlan`, `ConsumedOutputPreparationMaterial`, `ConsumedRedactionMaterial`, `DeferredProtocolDestinationBinding`, `OutputPreparationAttempt`, `PreparedInvocationResources`, and `TerminalPublicationAuthority` MUST each be privately branded and bound to the same invocation token.

The visible fields on `ConsumedOutputPreparationMaterial`, `ConsumedRedactionMaterial`, and `TerminalPublicationAuthority` MUST be informational only.

The output port MUST implement these semantic responsibilities:

```ts
interface InvocationOutputPort {
  prevalidate(request: OutputAdmissionRequest): Promise<OutputPathAdmission>;
  beginClaim(attempt: OutputClaimAttempt): void;
  beginPreparation(
    attempt: OutputPreparationAttempt,
    material: ConsumedOutputPreparationMaterial,
    redaction: ConsumedRedactionMaterial,
  ): void;
  appendLifecycleEvent(
    authority: TerminalPublicationAuthority,
    event: AgentEvent,
  ): Promise<OutputAppendResult>;
  publishRawResponse(
    authority: TerminalPublicationAuthority,
    eligibility: RawFinalResponseEligibility,
    bytes: Uint8Array,
  ): Promise<RawResponsePublicationResult>;
  publishTerminalResult(
    authority: TerminalPublicationAuthority,
    result: AgentInvocationResult,
  ): Promise<TerminalResultPublicationResult>;
  cleanupScratch(authority: TerminalPublicationAuthority): Promise<ScratchCleanupResult>;
  quiesce(authority: TerminalPublicationAuthority): Promise<OutputQuiescenceResult>;
}
```

Every output method after `beginClaim` MUST authenticate the capability and invocation token.

Every asynchronous output method, including `prevalidate`, MUST fulfill a closed typed result and MUST NOT reject.

The execution-owned output-preparation factory MUST synchronously authenticate one claimed session and create one `TerminalPublicationAuthority` plus both preparation promises before it returns the attempt.

Creating that attempt MUST perform no filesystem mutation and MUST be infallible for an authentic claimed session; an authentication disagreement is the section 10 internal-invariant failure.

Application MUST synchronously insert the attempt, its authority, and both promises into pending-start and shutdown drainage before it consumes output-preparation or redaction material and before it calls `beginPreparation`.

No await, callback, event delivery, or re-entrant boundary MAY occur from the first consume through `beginPreparation`.

`beginPreparation` MUST be synchronous at its call boundary, catch its own synchronous implementation failure, and MUST NOT throw to application.

A synchronous failure before mutation dispatch MUST settle as `rejected/internal_before_mutation` with quiescent undispatched state and the identical authority.

A synchronous failure after mutation dispatch MUST settle as `uncertain/preparation_state_unknown` with retained quiescence and the identical authority.

Cancellation observed before mutation MUST settle as `rejected/cancelled_before_mutation`; cancellation after mutation MUST NOT revoke or reinterpret claimed-output ownership.

The preparation deadline MUST be armed before `beginPreparation` and MUST use the fixed private 10-second output-preparation bound.

If the deadline wins after mutation dispatch, settlement MUST be `uncertain/preparation_timeout` and quiescence MUST be `retained`.

Every rejected or uncertain result and every retained quiescence MUST return the attempt's identical `TerminalPublicationAuthority` by object identity.

Both preparation promises MUST fulfill exactly once and MUST NOT reject.

Preparation MUST return `PreparedInvocationResources` and the same pre-established authority only after all planned bytes, attestations, redaction front ends, raw evidence destinations, and the unbound protocol destination binding are complete.

The terminal publication authority MUST remain in the pending/accepted lifecycle owner.

The terminal publication authority MUST NOT be consumed into `PreparedExecution` or exposed to the process adapter.

Before spawn, `InvocationOutputPort` MUST exclusively create `.scratch` when needed and MUST exclusively create `events.ndjson`, `stdout.log`, and `stderr.log` under the pre-established authority.

`.scratch` MUST use mode `0700` on POSIX.

Scratch files and evidence files MUST use mode `0600` on POSIX.

Every existing object or symlink at a manager-reserved path MUST fail closed and MUST NOT be followed or replaced.

Prompt and schema files MUST contain the exact planned bytes without a newline or byte-order mark.

A file attestation MUST be recorded only after exact write and file flush.

A file attestation MUST contain its slot, exact path, byte length, and SHA-256.

The output adapter MUST take exclusive ownership of the consumed payload and redaction-material references before its first mutation.

On prepared settlement it MUST zero-fill and release each owned mutable scratch payload immediately after successful flush, release the secret-registration reference after all three redaction front ends exist, and transfer only those one-use front ends plus the matching deferred protocol destination binding in `PreparedInvocationResources`.

On rejected settlement it MUST close and dispose every opened destination and redaction front end, zero-fill every owned mutable payload and redaction carry buffer, release all payload and secret-registration references, and finish quiescence before the result becomes observable.

On uncertain settlement the identical terminal authority MUST retain the operation ledger, late settlement continuations, opened destinations, and every not-yet-disposed owned reference. A late prepared result MUST be quarantined and disposed; it MUST NOT become spawn-eligible.

Every preparation close, zero-fill, reference release, and late-resource disposal MUST run in the authority's serialized preparation lane. The lane MUST settle as quiescent or retained no later than 10 seconds from the start of that disposal; timeout MUST retain the same authority and MUST NOT be reported as successful disposal.

`PreparedInvocationResources` MUST privately own only attestations, the three one-use redaction front ends, the protocol channel's matching one-use deferred destination binding, and the claimed-session cleanup binding required by finalization.

`TerminalPublicationAuthority` MUST own the retained handles and same-directory temporary-file capability required for lifecycle NDJSON, raw-response publication, terminal result publication, scratch cleanup, and quiescence.

`appendLifecycleEvent` MUST preserve the current `recordEvent` responsibility.

`publishTerminalResult` MUST preserve and strengthen the current `recordTerminalResult` responsibility.

`publishRawResponse` MUST be the sole publisher of `raw-final-response.txt`.

`raw-final-response.txt` and `result.json` MUST each use a same-directory exclusively created temporary file, exact write, file flush, non-replacing hard-link publication, supported directory flush, and manager-owned temporary unlink.

`publishRawResponse` MUST authenticate the ADR-0003 eligibility capability and write exactly the retained independently redacted bytes it receives.

`publishRawResponse` MUST zero-fill and release its owned mutable input after publication settles.

`publishTerminalResult` MUST write one complete UTF-8 JSON serialization of the supplied immutable `AgentInvocationResult`.

`appendLifecycleEvent` MUST write one complete UTF-8 JSON object followed by one LF byte.

Replacing rename MUST NOT be used for terminal publication.

An existing `raw-final-response.txt` or `result.json` MUST fail publication and MUST remain unchanged.

`events.ndjson` MUST contain only complete bounded lifecycle-event lines.

`events.ndjson` MUST reserve capacity for at most one final nonterminal lifecycle line and one `invocation.finished` line as required by AgentManager v1.

Exhaustion of the nonterminal event budget MUST suppress only the candidate nonterminal file line and MUST NOT change invocation outcome.

File-line suppression MUST NOT suppress process-local lifecycle delivery.

The reserved `invocation.finished` line MUST NOT be reported as budget-suppressed.

`stdout.log` and `stderr.log` MUST receive only bounded independently redacted bytes.

A rejected preacceptance start after claim MUST NOT publish `raw-final-response.txt`, `result.json`, or any public lifecycle line.

A rejected preacceptance start after claim MUST leave the output leaf as consumer-owned quarantined residue.

Cleanup MAY delete only manager-created scratch and temporary objects.

Cleanup MUST NOT delete the output leaf, an ancestor, or a committed evidence filename.

Preparation quiescence and later terminal-output quiescence MUST each settle under their fixed private 10-second bound.

A retained output-quiescence result MUST keep the terminal publication authority, ID reservation, stable-ancestor obligation, and manager failed-closed state until external reconciliation.

Shutdown MUST drain every registered preparation attempt and authority concurrently under the fixed private preparation and output-quiescence bounds. It MUST request cancellation, await settlement and quiescence, dispose a late prepared resource set without spawning, and then quiesce the same authority.

An unresolved preparation operation or output authority after that bounded drainage MUST reject shutdown, retain the authority and ID reservation, keep the output quarantined, and keep the manager failed closed.

## 10. Resource binding and one-use prepared execution

The resource finalizer MUST be synchronous.

The resource finalizer MUST authenticate prepared invocation, prepared resources, prepared security, and exact token identity.

The resource finalizer MUST verify every required file attestation.

The resource finalizer MUST replace each file slot only with its already planned and attested exact path.

The resource finalizer MAY repeat argument, byte, and attestation invariants only as package-defect assertions. It MUST verify an authentic preclaim secret-exclusion proof marker and MUST NOT retain, rehydrate, or re-enumerate secret values. These assertions MUST NOT create a caller-, definition-, limit-, or environment-failure surface after claim.

The resource finalizer MUST NOT apply defaults, validate consumer schemas, map permissions, interpret templates, select bindings, construct paths, write files, probe executables, or change semantic bytes.

The exact deferred protocol-destination bind result MUST be:

```ts
type ProtocolDestinationBindResult =
  | Readonly<{ status: 'bound' }>
  | Readonly<{
      status: 'rejected';
      reason: 'internal_invariant_violation';
    }>;
```

For every binding, output preparation MUST create one protocol redaction front end with an empty private destination slot and one matching `DeferredProtocolDestinationBinding`.

While that slot is empty, the front end MUST retain and buffer zero protocol bytes. Any `ProcessOutputSink.write` or `end` before binding MUST fail immediately with a package-private internal-invariant sentinel and MUST NOT enqueue, copy, redact, or forward the supplied bytes.

During resource finalization, the selected protocol driver MUST synchronously create one authentic `PreparedProtocolSession` before process spawn. The authorized bind helper MUST authenticate the prepared resources, deferred binding, prepared protocol session, and exact invocation token.

On success, the helper MUST copy `PreparedProtocolSession.protocolOutput` into the empty private destination slot, atomically mark the binding consumed, clear its local destination reference, and return `bound` before any process or protocol callback can run.

A second bind, cross-invocation bind, inauthentic carrier, missing destination, already-disposed binding, or protocol-session construction/bind exception MUST return or be caught as `internal_invariant_violation`. A second bind MUST NOT replace or observe the first destination.

Bind rejection MUST use the section 10 quarantine mapping exactly: dispose the created protocol session when present, dispose all three redaction front ends and the deferred binding, retain terminal cleanup/publication authority, map to `revo.agent.internal` at `starting`, and publish no lifecycle line, raw response, or terminal result.

Disposal of an unbound front end MUST mark its binding disposed, clear and zero-fill owned mutable redaction carry, and retain no destination. Disposal of a bound front end MUST atomically clear its destination reference; the same owner MUST dispose the matching protocol session exactly once. Prepared-execution rejection, spawn rejection, identity rejection, accepted terminal drain, retained-cleanup continuation, and shutdown MUST each dispose whichever bound or unbound graph they own.

After binding, streaming MUST remain backpressure-aware and bounded by the channel carry and the fixed private policy of at most 1 MiB per protocol frame, 10,000 accepted frames, and 64 pending writes; the deferred binding MUST NOT introduce a pre-bind queue or an additional byte budget.

The finalizer result MUST be:

```ts
type FinalizePreparedExecutionResult =
  | Readonly<{ status: 'prepared'; execution: PreparedExecution }>
  | Readonly<{
      status: 'rejected';
      reason: 'internal_invariant_violation';
    }>;
```

A carrier-authentication, invocation-token, definition binding, deferred-destination binding, resource, attestation, one-use transfer, repeated bound, or repeated secret-exclusion mismatch MUST map exactly to `internal_invariant_violation`.

No postclaim finalization rejection MAY expose `limit_invalid`, `environment_invalid`, a bounds-specific reason, a secret-specific reason, or another deterministic caller-fault category.

The public preacceptance mapping MUST be exactly `revo.agent.internal` at phase `starting` with bounded redacted package-invariant evidence only.

A rejected finalization MUST consume or dispose every taken bundle, including every redaction front end and untaken mutable buffer.

A rejected finalization MUST retain claimed-output cleanup and publication authority in the rejection coordinator.

The claimed output MUST remain quarantined; the rejection coordinator MUST drain scratch cleanup and output quiescence, MUST NOT publish a lifecycle line, raw-final response, or terminal result, and MUST fail the manager closed if authority quiescence is not confirmed.

`PreparedExecution` MUST expose only:

```ts
interface PreparedExecutionView {
  readonly invocationId: string;
  readonly pin: PreparedInvocationView['pin'];
  readonly reportedVersion: string;
  readonly binding: ExecutionBinding;
}
```

`PreparedExecution` MUST privately own one `OwnedExecutionStartMaterial | undefined` field.

The authorized consume operation MUST synchronously authenticate the caller, copy the private reference to a local, set the private field to `undefined`, mark the source consumed, and only then return a private consumed carrier.

A second consume MUST fail before process-port invocation.

The consumed carrier MUST privately own one exact process-start request, one prepared protocol session, the result validator, protocol payloads, effective limits, disposal state, and the one-use stream capabilities.

The consumed carrier MUST atomically clear each component before transferring it onward.

No frozen or long-lived visible object MAY retain argv, environment, prompt/schema bytes, registered secrets, raw sinks, a live process, or signalling authority.

No await or callback MAY occur between successful finalization and entry into `execution.start(preparedExecution)`.

## 11. Direct process and duplex protocol contract

The provider-neutral protocol contract MUST be:

```ts
interface ProtocolDriverCreateRequest {
  readonly invocationId: string;
  readonly delivery: ExecutionBinding['delivery'];
  readonly cancellationSupported: boolean;
  readonly promptBytes?: Uint8Array;
  readonly canonicalResultSchemaBytes?: Uint8Array;
  readonly resultParser?: ResultParserPort;
}

interface ProtocolDriverPort {
  readonly id: ProtocolDriverId;
  create(request: ProtocolDriverCreateRequest): PreparedProtocolSession;
}

interface PreparedProtocolSession {
  readonly protocolOutput: ProcessOutputSink;
  attach(input: ProcessInputSink): Promise<ProtocolAttachResult>;
  dispose(): void;
}

type ProtocolAttachResult =
  | Readonly<{ status: 'attached'; session: AttachedProtocolSession }>
  | Readonly<{
      status: 'failed';
      reason: 'attach_failed' | 'stdin_write_failed' | 'stdin_end_failed';
    }>;

interface AttachedProtocolSession {
  finishAfterProtocolOutputEnd(): Promise<ProtocolObservationResult>;
  requestCancellation(): Promise<'sent' | 'unsupported' | 'failed'>;
  closeInput(): Promise<void>;
  dispose(): void;
}

type ProtocolObservationResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: AgentUsage;
      rawResponse?: BoundedRawResponseEvidence;
    }>
  | Readonly<{
      status: 'failed';
      failure:
        | Readonly<{ kind: 'protocol_sink_failed' }>
        | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>;
      rawResponse?: BoundedRawResponseEvidence;
    }>;
```

Prompt bytes MUST be present in the create request exactly for `stdin` or `protocol` delivery.

Canonical result-schema bytes MUST be present exactly for `protocol` delivery.

A result parser MUST be present exactly for `stdout` result delivery.

The create request MUST contain no registry, full definition, permission strategy, output path planner, or consumer callback.

The protocol driver MUST defensively take ownership of fresh byte copies.

`PreparedProtocolSession` MUST be privately branded and bound to the same invocation token as the finalization material. Its `protocolOutput` capability MUST be read only by the authorized deferred-destination bind helper and MUST NOT be exposed to application, process, lifecycle, or consumer code.

Protocol attach and finish MUST fulfill their closed unions and MUST NOT reject.

Protocol drivers MUST apply the fixed private policy of a 1 MiB frame bound, 10,000 accepted frames, 64 pending writes, and a 10-second bound for each duplex operation. These values MUST NOT come from a public request or manager option.

The accepted-frame count MUST increment only after a complete frame passes framing validation.

The pending-write count MUST increment before enqueue and MUST decrement in `finally`.

A 65th pending write MUST fail before enqueue and MUST submit `protocol_sink_failed`.

A frame-byte, parser-carry, or accepted-frame-count excess MUST submit `parser_failed/frame_overflow`.

The process port MUST accept the exact direct-spawn contract:

```ts
interface ProcessInputSink {
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
  abort(): Promise<void>;
}

interface ProcessStartRequest {
  readonly invocationId: string;
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly stdin: 'pipe';
  readonly stdout: ProcessOutputSink;
  readonly stderr: ProcessOutputSink;
}

interface SpawnAcceptedProcess {
  readonly invocationId: string;
  readonly spawnedAt: number;
}

interface PausedProcessIo {
  readonly invocationId: string;
}

interface DuplexCoordinatorRegistration {
  readonly invocationId: string;
}

interface LiveOwnedProcess {
  readonly spawnedAt: number;
  readonly completion: Promise<ProcessExitObservation>;
  readonly identity: ProcessIdentity;
  readonly stdin: ProcessInputSink;
  terminateAndReap(): Promise<void>;
}

type ProcessStartResult =
  | Readonly<{
      status: 'spawn_accepted';
      process: SpawnAcceptedProcess;
      io: PausedProcessIo;
    }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_spawn'
        | 'manager_shutdown_before_spawn'
        | 'spawn_failed'
        | 'internal_invariant_violation';
    }>;

type ProcessStartQuiescence =
  | Readonly<{
      status: 'quiescent';
      disposition: 'not_spawned' | 'cleanup_confirmed' | 'transferred_to_coordinator';
    }>
  | Readonly<{
      status: 'retained';
      authority: RetainedCleanupAuthority;
    }>;

interface ProcessStartAttempt {
  readonly invocationId: string;
  readonly settlement: Promise<ProcessStartResult>;
  readonly quiescence: Promise<ProcessStartQuiescence>;
  requestCancellation(reason: 'caller_cancel' | 'manager_shutdown'): void;
}

type ProcessIdentityInspectionResult =
  | Readonly<{
      status: 'identified';
      identity: ProcessIdentity;
    }>
  | Readonly<{
      status: 'failed';
      reason: 'inspection_failed' | 'fingerprint_failed' | 'deadline';
    }>;

type ProcessIoActivationResult =
  | Readonly<{
      status: 'activated';
      process: LiveOwnedProcess;
    }>
  | Readonly<{
      status: 'rejected';
      reason: 'internal_invariant_violation';
    }>;

interface ProcessSupervisionPort {
  beginStart(attempt: ProcessStartAttempt, request: ProcessStartRequest): void;
  inspectIdentity(
    process: SpawnAcceptedProcess,
    activeStateDeadline: number,
  ): Promise<ProcessIdentityInspectionResult>;
  activateIo(
    process: SpawnAcceptedProcess,
    io: PausedProcessIo,
    identity: ProcessIdentity,
    coordinator: DuplexCoordinatorRegistration,
  ): ProcessIoActivationResult;
}
```

The platform adapter MUST invoke the native spawn function synchronously before its first await.

The platform adapter MUST pass executable and arguments separately.

The platform adapter MUST use piped stdin, stdout, and stderr.

The platform adapter MUST clear temporary request, argv, and environment containers after the native spawn call accepts them.

The package does not claim physical erasure of strings copied by the JavaScript engine or operating system.

The execution-owned start-attempt factory MUST allocate both promises, empty branded spawn/paused-I/O carriers, timer callbacks, cleanup continuation slots, and caller-cancellation registration before spawn dispatch. Application MUST synchronously insert the attempt and both promises into pending-start and shutdown drainage before calling `beginStart`.

No await, event delivery, caller callback, or re-entrant boundary MAY occur between drain insertion and `beginStart`.

`beginStart` MUST be synchronous at its call boundary, invoke native spawn synchronously before returning, catch its own failure, and MUST NOT throw to application. Both attempt promises MUST fulfill exactly once and MUST NOT reject.

`ProcessStartRequest` MUST be privately branded and bound to the same invocation token as `PreparedExecution`; `invocationId` is informational and MUST NOT itself authorize spawn, signalling, reap, or retained-authority construction. The lower boundary MUST authenticate the request before native spawn.

`ProcessStartAttempt`, `ProcessStartRequest`, `SpawnAcceptedProcess`, and `PausedProcessIo` MUST be privately branded and bound to the same invocation token. `invocationId` and `spawnedAt` are informational and MUST NOT authorize spawn, signalling, reap, I/O activation, or retained-authority construction.

An inauthentic or cross-invocation attempt/request pair MUST settle `rejected/internal_invariant_violation` with `quiescent/not_spawned` before native spawn and MUST map to quarantined `revo.agent.internal` at `starting`.

`rejected/spawn_failed` MUST mean that no native child was created or accepted and MUST carry no process, identity, signal, reap, or cleanup authority.

A native-spawn failure after authentication but before native child acceptance MUST settle `rejected/spawn_failed` and `quiescent/not_spawned`.

Caller cancellation observed before native spawn dispatch MUST settle `rejected/cancelled_before_spawn`; manager shutdown observed before dispatch MUST settle `rejected/manager_shutdown_before_spawn`. Both MUST settle `quiescent/not_spawned`. Either request after dispatch MUST submit its exact pending-start candidate and MUST NOT revoke or reinterpret a successful spawn.

`requestCancellation` MUST be synchronous, idempotent per reason, and non-throwing. Caller cancellation and manager shutdown MUST race through one atomic commit; neither has priority before one commits.

Every pre-spawn rejection MUST dispose the empty preallocated spawn/I/O carriers, prepared protocol session, bound deferred destination, stdin payload, and all stream front ends before its quiescence becomes observable.

Immediately after native spawn accepts a child, the lower boundary MUST, without an await or external callback: record monotonic `spawnedAt`; wrap that exact child/group in one private live signalling/reap authority; fill the preallocated `SpawnAcceptedProcess` and `PausedProcessIo`; arm wall, idle, and the single active-state setup deadline; attach child-exit and cleanup continuations; then settle `spawn_accepted`.

The post-acceptance transition MUST fill the factory-preallocated private carrier slots rather than allocate an unregistered owner. If any adapter defect occurs after native acceptance during slot fill, timer arming, or settlement, the attempt MUST still own the native handle, settle `spawn_accepted` with its preallocated authentic carriers, synchronously submit `internal_invariant_violation`, and begin confirmed-or-retained cleanup. It MUST NOT fall back to a pre-spawn rejection.

Wall and idle deadlines MUST therefore begin at actual native spawn acceptance, before identity inspection, fingerprinting, initial active-state save, acceptance, handle creation, coordinator registration, I/O activation, or handle return. The active-state setup deadline MUST be exactly `spawnedAt + activeStateOperationTimeoutMs` and MUST NOT be reset.

The attempt MUST remain the registered owner of the private live authority from spawn acceptance until either cleanup is confirmed, the identical authority is transferred to the sole duplex coordinator, or the identical authentic `RetainedCleanupAuthority` is returned in quiescence.

Caller cancellation, wall timeout, idle timeout, manager shutdown, child exit, identity inspection/fingerprint failure or deadline, and initial active-state save failure or deadline MUST submit to the pending-start arbiter while that authority remains owned by the attempt.

A winning candidate MUST abort outstanding identity inspection or fingerprint work when supported. Its late settlement MUST be drained under the start attempt, MUST NOT enable activation or acceptance, and MUST NOT replace the winning primary.

Every winning post-spawn rejection MUST start authoritative cleanup through that same live authority. Confirmed group absence and leader reap MUST settle quiescence as `cleanup_confirmed`; timeout, rejection, unknown group state, live group, or unconfirmed reap MUST settle `retained` with the authentic retained authority that owns the child/group, outstanding cleanup, timers, paused-or-active I/O handles, protocol/stream disposal, active-state reconciliation when applicable, and terminal output quiescence.

Before native spawn acceptance the consumed execution carrier owns the prepared protocol session, bound deferred destination, stdin payload, and stream graph. After acceptance those disposal obligations MUST transfer to the attempt with the live authority. No branch MAY drop or duplicate either ownership.

No disposal path MAY signal by copied identity. Only the attempt's private live authority, the running coordinator after successful transfer, or the authentic retained cleanup authority after uncertain transfer MAY signal or reap.

Identity inspection and fingerprinting MUST operate on authentic `SpawnAcceptedProcess`, MUST use only the remaining active-state setup deadline, MUST fulfill `ProcessIdentityInspectionResult`, and MUST NOT reject. Identity failure before I/O activation MUST close stdin, leave OS stdout/stderr pumps unstarted, perform authoritative cleanup, and after confirmed reap close the unread pipe handles and dispose the unactivated protocol/stream graph without invoking stdout, stderr, protocol, parser, or lifecycle callbacks. If cleanup is uncertain, the retained authority MUST own those paused handles and disposal obligations until late confirmation.

`PausedProcessIo` MUST mean that native stdout and stderr pipe handles exist but package read/pump registration has not started. Before activation the package MUST invoke no stdout or stderr sink, protocol, parser, subscriber, or lifecycle callback and MUST allocate no user-space child-output buffer; only the operating system's bounded pipe capacity MAY hold child bytes.

After identity succeeds and no earlier candidate has won, application MUST dispatch and fulfill the initial `running` save while I/O remains paused. It MUST then atomically commit acceptance, create the public handle, and synchronously construct and drain-register one authentic `DuplexCoordinatorRegistration`. The activation helper MUST authenticate the spawn carrier, paused I/O, identified process, coordinator registration, and invocation token; atomically install stdout, stderr, stdin, exit, cancellation, timer, and cleanup routing into that sole coordinator; mark the activation capability consumed; transfer the live authority and start-attempt timers; fulfill attempt quiescence as `transferred_to_coordinator`; and only then start stdout/stderr pumps and return `activated`.

No await, event delivery, caller callback, timer callback, or re-entrant boundary MAY occur between coordinator drain registration and `activateIo` entry. A process exit or another pending-start candidate committed before acceptance MUST prevent acceptance, registration, and activation. A terminal candidate observed after acceptance MUST use the accepted lifecycle and MUST NOT retroactively reject `start()`.

At `activateIo` entry the helper MUST compare the monotonic clock with wall and idle deadlines and synchronously submit every due candidate to the accepted lifecycle's atomic terminal commit. If one commits first, the helper MUST leave I/O paused, skip activation, and clean through the accepted lifecycle authority.

Activation MUST be synchronous and exactly once. Double activation, cross-invocation activation, activation after disposal, missing callback registration, or partial installation MUST return `rejected/internal_invariant_violation`, MUST NOT start or restart a pump, and after acceptance MUST become an accepted typed `revo.agent.internal` terminal candidate with confirmed-or-retained cleanup rather than a rejected start.

`activateIo` MUST NOT throw. `inspectIdentity` and every cleanup/quiescence helper in this start path MUST fulfill its closed result and MUST NOT reject.

After activation, each stdout pump iteration MUST await both ordered fan-out branches before reading the next chunk, and stderr MUST await its evidence branch before the next read. Existing redaction carry and stream byte bounds plus the fixed private frame, accepted-frame, pending-write, and 10-second duplex-operation bounds MUST apply; activation MUST introduce no queue or additional byte budget.

If a preacceptance candidate wins while I/O is paused, activation MUST NOT occur and `start()` MUST reject after confirmed-or-retained cleanup. If an accepted terminal candidate commits before activation, activation MUST NOT occur but the already-created handle MUST resolve through the typed terminal-result path. Confirmed cleanup MUST dispose paused handles and the prepared protocol/stream graph without callbacks. Unconfirmed cleanup MUST transfer all of them to the retained authority. If a candidate commits after activation, the coordinator MUST stop new reads, close stdin, perform authoritative cleanup, drain already-issued bounded callbacks, dispose the graph, and preserve the committed primary.

`ProcessInputSink.write` MUST propagate backpressure.

A write after end or abort MUST fail.

`end` and `abort` MUST be idempotent.

For prompt delivery `stdin`, attach MUST write the exact prompt UTF-8 bytes without a newline or byte-order mark and then end stdin.

For prompt delivery `argument` or `file`, attach MUST end stdin without writing prompt bytes.

For protocol delivery, the selected driver MUST own bounded initialization, prompt, result-schema, and cancellation frame writes.

Stdout MUST fan out in order to the independently redacted stdout evidence sink and the independently redacted protocol observer.

Stderr MUST flow only through its independently redacted evidence sink.

A raw stdout or stderr chunk MUST NOT bypass these channels.

A failure in any fan-out branch MUST enter the terminal coordinator and MUST trigger authoritative cleanup.

The result parser MUST receive only bytes emitted by the protocol redaction channel.

The parser and protocol session MUST NOT observe process exit.

The parser and protocol session MUST NOT own a completion promise that competes with the duplex terminal coordinator.

## 12. Exact parser taxonomy

The parser failure taxonomy MUST be exactly:

```ts
type ParserFailureReason =
  | 'response_empty'
  | 'response_too_large'
  | 'invalid_utf8'
  | 'invalid_json'
  | 'response_not_object'
  | 'frame_malformed'
  | 'frame_overflow'
  | 'duplicate_terminal'
  | 'missing_terminal';
```

No parser result MAY replace two or more of these reasons with `malformed`, `overflow`, `invalid`, or another aggregate reason.

The parser contract MUST be:

```ts
type ResultParserWriteResult =
  | Readonly<{ status: 'observed' }>
  | Readonly<{ status: 'failed'; reason: ParserFailureReason; raw?: BoundedRawResponseEvidence }>;

type ResultParserEndResult =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      usage?: AgentUsage;
      raw?: BoundedRawResponseEvidence;
    }>
  | Readonly<{ status: 'failed'; reason: ParserFailureReason; raw?: BoundedRawResponseEvidence }>;

interface ResultParserPort {
  readonly id: ResultParserId;
  writeProtocolBytes(bytes: Uint8Array): ResultParserWriteResult;
  endProtocolBytes(): ResultParserEndResult;
  dispose(): void;
}
```

Parser operations MUST return their closed union and MUST NOT throw.

`response_empty` MUST mean that the selected terminal response payload exists and contains zero bytes.

`response_too_large` MUST mean that the selected terminal response payload exceeds effective `maxRawResponseBytes`.

`invalid_utf8` MUST mean that the selected terminal response payload is not strict UTF-8.

`invalid_json` MUST mean that strict UTF-8 decoded but JSON parsing failed.

`response_not_object` MUST mean that JSON parsing succeeded but the value is not a top-level object.

`frame_malformed` MUST mean that a complete candidate frame violates the installed frame grammar before terminal-payload interpretation.

`frame_overflow` MUST mean that a frame, parser carry, or accepted-frame count exceeds its effective bound.

`duplicate_terminal` MUST mean that more than one terminal frame is observed.

`missing_terminal` MUST mean that protocol input ended without exactly one terminal frame.

The parser MUST preserve the exact reason through protocol observation, duplex terminal observation, normalization, diagnostics, and conformance assertions.

The parser MUST produce a package-owned deeply frozen `JsonObject` only after strict UTF-8, JSON, and top-level-object validation.

Result-schema validation MUST occur exactly once after parser success and MUST use diagnostic root `/result`.

A parser MUST NOT validate the consumer result schema.

## 13. Running execution, process identity, and terminal authority

The package-private execution port aggregate MUST be:

```ts
interface InvocationClock {
  now(): number;
  schedule(delayMs: number, callback: () => void): () => void;
}

interface InvocationExecutionPorts {
  readonly execution: {
    start(prepared: PreparedExecution): Promise<ExecutionStartResult>;
  };
  readonly workspace: {
    admit(path: string): Promise<WorkspaceAdmissionResult>;
  };
  readonly output: InvocationOutputPort;
  readonly clock: InvocationClock;
}
```

The execution start contract MUST be:

```ts
type ExecutionStartResult =
  | Readonly<{ status: 'started'; execution: RunningExecution }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'cancelled_before_spawn'
        | 'manager_shutdown_before_spawn'
        | 'spawn_failed'
        | 'internal_invariant_violation';
      cleanup: Readonly<{ status: 'not_required' }>;
    }>
  | Readonly<{
      status: 'rejected';
      reason:
        | 'process_identity_failed'
        | 'cancelled'
        | 'wall_timeout'
        | 'idle_timeout'
        | 'manager_shutdown'
        | 'process_exited_before_acceptance'
        | 'internal_invariant_violation';
      cleanup:
        | Readonly<{ status: 'confirmed'; exit: ProcessExitObservation }>
        | Readonly<{ status: 'uncertain'; authority: RetainedCleanupAuthority }>;
    }>;

interface RunningExecution {
  readonly spawnedAt: number;
  readonly identity: ProcessIdentityView;
  readonly completion: Promise<DuplexTerminalObservation>;
  requestCancellation(): Promise<void>;
}
```

`execution.start` MUST authenticate and consume `PreparedExecution` exactly once.

`execution.start` MUST fulfill its closed union and MUST NOT reject.

Pre-spawn caller cancellation, manager shutdown, spawn failure, and pre-spawn internal rejection MUST expose no live-process authority and MUST map to the matching upper reason with `cleanup/not_required`.

After `spawn_accepted`, `execution.start` MUST inspect/fingerprint using the attempt while I/O remains paused. The application MUST complete the initial `running` save, commit acceptance, and create the handle before it registers the sole coordinator and activates paused I/O exactly once. `execution.start` MUST return `started` with the accepted execution after the activation attempt; an activation or immediately observed parser, schema, or valid-result outcome is postacceptance and resolves through that handle rather than rejecting `start()`.

A winning post-spawn candidate before that transfer MUST return the exact upper reason with confirmed cleanup or the identical authentic retained cleanup authority from start-attempt quiescence.

No upper layer MAY synthesize a retained authority from PID, PGID, fingerprint, structural data, or an exception.

Coordinator construction, registration, or activation failure after acceptance MUST submit `internal_invariant_violation` through the accepted lifecycle's terminal arbiter, clean through the same live authority, and resolve the created handle with a typed terminal result. It MUST NOT retroactively reject `start()`.

`ProcessIdentityView` MUST expose exactly `pid`, `processGroupId`, and `fingerprint`.

`ProcessIdentityView` MUST defensively copy and freeze those values.

`ProcessIdentityView` MUST be privately branded.

`ProcessIdentityView` MUST expose no signal, terminate, reap, process object, file descriptor, or callback.

A brand-checking read helper MUST return a fresh frozen copy for active-state persistence.

Persisted identity and `ProcessIdentityView` MUST NOT authorize process signalling.

Only the coordinator's private live-owned process capability MAY authorize normal in-memory signalling.

After acceptance and coordinator registration, attach, stdin, stdout, stderr, protocol, parser, schema, exit, cancellation, deadline, natural-exit group-cleanup, and other cleanup outcomes MUST be submitted to one duplex terminal coordinator. While process I/O remains paused before acceptance, process exit is a private rejected-start candidate and parser, schema, or valid-result observations cannot occur.

No other object MAY construct a duplex terminal variant.

## 14. Duplex terminal observation and evidence

The exact terminal union MUST be:

```ts
type DuplexPrimaryFailure =
  | Readonly<{ kind: 'attach_failed' }>
  | Readonly<{ kind: 'stdin_write_failed' }>
  | Readonly<{ kind: 'stdin_end_failed' }>
  | Readonly<{ kind: 'stdout_sink_failed' }>
  | Readonly<{ kind: 'stderr_sink_failed' }>
  | Readonly<{ kind: 'protocol_sink_failed' }>
  | Readonly<{ kind: 'parser_failed'; reason: ParserFailureReason }>
  | Readonly<{ kind: 'result_schema_failed' }>
  | Readonly<{ kind: 'process_failed' }>
  | Readonly<{
      kind: 'duplex_operation_timeout';
      operation: DuplexOperation;
    }>
  | ProcessCleanupFailure;

type ProcessCleanupFailureCause =
  | 'inspection_timeout'
  | 'inspection_rejected'
  | 'group_state_unknown'
  | 'termination_rejected'
  | 'post_kill_confirmation_timeout'
  | 'post_kill_confirmation_rejected'
  | 'group_still_live'
  | 'leader_reap_timeout'
  | 'leader_reap_rejected';

interface ProcessCleanupFailureEvidence {
  readonly trigger: 'natural_exit';
  readonly cause: ProcessCleanupFailureCause;
  readonly termSent: boolean;
  readonly killSent: boolean;
  readonly lastKnownGroupState: 'absent' | 'present' | 'unknown';
  readonly leaderReapState: 'confirmed' | 'pending' | 'unknown';
}

interface ProcessCleanupFailure {
  readonly kind: 'process_cleanup_failed';
  readonly cause: ProcessCleanupFailureCause;
  readonly evidence: ProcessCleanupFailureEvidence;
}

type DuplexTerminalObservation =
  | Readonly<{
      status: 'completed';
      response: JsonObject;
      exit: ProcessExitObservation;
      usage?: AgentUsage;
      rawResponse?: BoundedRawResponseEvidence;
    }>
  | Readonly<{
      status: 'cancelled';
      exit: ProcessExitObservation;
      usage?: AgentUsage;
      rawResponse?: BoundedRawResponseEvidence;
      providerCancellation: 'sent' | 'unsupported' | 'failed' | 'not_declared';
    }>
  | Readonly<{
      status: 'failed';
      primary: DuplexPrimaryFailure;
      exit: ProcessExitObservation;
      usage?: AgentUsage;
      rawResponse?: BoundedRawResponseEvidence;
      schemaDiagnostics?: AgentValidationDetails;
    }>
  | Readonly<{
      status: 'cleanup_uncertain';
      primary: Readonly<{ kind: 'cancelled' }> | DuplexPrimaryFailure;
      authority: RetainedCleanupAuthority;
      exit?: ProcessExitObservation;
      usage?: AgentUsage;
      rawResponse?: BoundedRawResponseEvidence;
      schemaDiagnostics?: AgentValidationDetails;
    }>;
```

`DuplexOperation` MUST distinguish attach, stdin write, stdin end, stdout write, stdout end, stderr write, stderr end, protocol write, protocol end, and parser finish.

Every duplex operation MUST arm the fixed private 10-second duplex-operation bound before dispatch.

Operation settlement MUST cancel its timer when settlement wins.

When the timer wins, the coordinator MUST submit `duplex_operation_timeout` with the exact operation.

The late operation settlement MUST remain attached for quiescence and disposal.

A duplex timeout followed by unconfirmed cleanup MUST produce `cleanup_uncertain` with retained cleanup authority.

The coordinator MUST allocate its one completion promise before protocol attach.

A successful terminal observation MUST require successful attach, required stdin delivery, stdout end, stderr end, protocol end, parser completion, result-schema validation, zero process exit without signal, confirmed natural-exit group cleanup, and leader reap.

After a natural leader exit, the coordinator MUST inspect the live-authorized group within 500 ms. If the group is absent and leader reap is confirmed, cleanup is confirmed without signalling.

If the group is live, the coordinator MUST send group `SIGTERM` and wait no more than 2,000 ms while observing group state. It MUST stop that wait as soon as group absence is confirmed and MUST NOT send `SIGKILL` in that case.

When and only when the group remains live at the end of that grace, the coordinator MUST send group `SIGKILL`; it MUST then wait no more than 500 ms for confirmed group absence and leader reap.

A timeout, rejected inspection or signal operation, unknown group state, still-live group after escalation, or unconfirmed leader reap MUST create the exact `ProcessCleanupFailure` cause above.

Cause selection MUST be mechanical: an inspection deadline is `inspection_timeout`; inspection rejection is `inspection_rejected`; a fulfilled inspection without a conclusive present/absent answer is `group_state_unknown`; rejected TERM or KILL dispatch is `termination_rejected`; rejected post-KILL inspection is `post_kill_confirmation_rejected`; a post-KILL deadline with the last conclusive state still present is `group_still_live`, otherwise `post_kill_confirmation_timeout`; and confirmed group absence followed by a leader-completion deadline or rejection is respectively `leader_reap_timeout` or `leader_reap_rejected`.

`ProcessCleanupFailure.cause` and `ProcessCleanupFailure.evidence.cause` MUST be identical; the fixed evidence fields are the entire retained natural-exit cleanup evidence surface.

When no earlier primary has won, natural-exit cleanup uncertainty MUST make that `ProcessCleanupFailure` the primary and MUST settle `cleanup_uncertain` with the retained cleanup authority and bounded copied evidence.

When an earlier primary already won, the same bounded process-cleanup failure MUST be retained as secondary cleanup evidence and MUST NOT replace that earlier primary; the observation still MUST be `cleanup_uncertain`.

A nonzero exit or signal MUST submit `process_failed` unless another candidate already won.

Cancellation MUST submit its candidate synchronously when the first cancellation request wins.

The first `RunningExecution.requestCancellation()` call MUST create one shared cancellation completion.

Concurrent and later calls MUST return the same completion.

The cancellation completion MUST fulfill after the cancellation candidate and authoritative local cleanup request are committed.

It MUST NOT wait for provider acknowledgement.

It MUST NOT reject because the provider hook is unsupported or failed.

Provider cancellation MUST be best-effort diagnostic evidence only.

Provider cancellation MUST NOT delay or replace local terminate/reap.

Every terminal source MUST compete through one atomic commit. The first candidate whose commit succeeds MUST become the immutable primary; a merely observed, queued, or submitted candidate has no precommit priority. When one callback observes several candidates, it MUST attempt their commits in the order in which that callback observes them, without a global failure-kind matrix. Promise or timer scheduling MUST NOT replace an already committed primary.

A winning failure or cancellation MUST start authoritative local cleanup immediately.

Confirmed cleanup MUST settle `failed` or `cancelled` with the winning primary and complete evidence.

Unconfirmed group absence or leader reap MUST settle only `cleanup_uncertain`.

`cleanup_uncertain` MUST NOT be normalized or committed as a public terminal result.

The retained cleanup authority MUST preserve the exact cleanup cause and evidence across retry, reconciliation, quiescence, and shutdown.

If later reconciliation confirms group absence and leader reap, terminal continuation MUST reuse the preserved primary without rerunning parser, schema, or arbitration. A preserved `process_cleanup_failed` primary MUST normalize to `revo.agent.process_cleanup_failed` with its exact cause and evidence even though cleanup is now confirmed.

After coordinator settlement, later observations MUST be drained and disposed but MUST NOT replace the settled union.

## 15. Evidence preservation and normalization

The provider-neutral usage and raw-evidence views MUST be:

```ts
interface AgentUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningOutputTokens?: number;
  readonly reportedCost?: number;
  readonly reportedCurrency?: string;
}

interface RawResponseEvidenceView {
  readonly byteLength: number;
  readonly retainedByteLength: number;
  readonly truncated: boolean;
  readonly preview: string;
}

interface BoundedRawResponseEvidence {
  readonly view: RawResponseEvidenceView;
}

type RawFinalResponseEligibility =
  | Readonly<{
      partition: 'result_extraction';
      reason: 'response_empty' | 'response_too_large' | 'duplicate_terminal' | 'missing_terminal';
    }>
  | Readonly<{
      partition: 'result_parsing';
      reason: 'invalid_utf8' | 'invalid_json' | 'response_not_object';
    }>
  | Readonly<{ partition: 'result_schema'; reason: 'result_schema_failed' }>;
```

`AgentUsage` MUST be provider-neutral, defensively copied, and frozen.

Usage token counts MUST be nonnegative safe integers.

Reported cost MUST be finite and nonnegative.

Reported currency MUST be valid Unicode and no more than 32 UTF-8 bytes.

`BoundedRawResponseEvidence` MUST contain only independently redacted bytes from the terminal candidate associated with result extraction, parsing, or schema validation, or bounded diagnostic bytes retained for a non-publishable protocol failure.

It MUST NOT contain unrelated stdout frames.

For `duplicate_terminal`, publishable raw evidence MUST be the second complete terminal candidate that caused the extraction failure. For `response_empty` and `missing_terminal`, the authentic publishable evidence carrier MUST exist with an empty retained byte sequence so canonical raw publication creates a zero-byte file.

`RawFinalResponseEligibility` MUST be minted only by normalization for the exact ADR-0003 partition above. `frame_malformed`, `frame_overflow`, transport, process, timeout, cancellation, output, cleanup, and internal failures MUST NOT mint it.

The normalized primary failure MUST itself be in that partition; secondary or late raw/parser evidence attached to another winning primary MUST NOT authorize publication.

The eligibility MUST be privately branded and bound to the same normalized observation and raw-evidence carrier; its visible partition and reason MUST NOT authorize publication by structural equality.

This specification preserves ADR-0003's failure-only result-extraction/parsing/validation boundary; it does not amend or broaden that accepted decision.

It MUST expose a frozen view containing full candidate byte length, retained byte length, truncation, and valid-Unicode preview.

It MUST retain at most effective `maxRawResponseBytes`.

Its preview MUST use at most `rawResponsePreviewBytes` retained bytes.

Invalid preview byte sequences MUST be rendered with U+FFFD.

A one-use byte-take helper MUST atomically remove the retained buffer before returning bytes for raw-response publication.

A second byte take MUST report `already_taken`.

Disposal MUST zero-fill any untaken mutable buffer.

Normalization MUST NOT decode, parse, freeze, or schema-validate provider bytes again.

Normalization MUST transfer the exact parsed object, parser reason, usage, exit, raw-response evidence, and bounded schema diagnostics.

The normalized contract MUST preserve structured failure evidence:

```ts
interface NormalizedInvocationEvidence {
  readonly exit: ProcessExitObservation;
  readonly usage?: AgentUsage;
  readonly rawResponse?: BoundedRawResponseEvidence;
  readonly rawFinalResponseEligibility?: RawFinalResponseEligibility;
  readonly schemaDiagnostics?: AgentValidationDetails;
}

type NormalizedInvocationFailure =
  | Readonly<{
      kind: 'parser';
      reason: ParserFailureReason;
      code:
        | 'revo.agent.result_missing'
        | 'revo.agent.result_too_large'
        | 'revo.agent.result_invalid_json'
        | 'revo.agent.result_not_object'
        | 'revo.agent.protocol_failed';
    }>
  | Readonly<{
      kind: 'duplex';
      primary: Exclude<
        DuplexPrimaryFailure,
        | Readonly<{ kind: 'parser_failed' }>
        | Readonly<{ kind: 'result_schema_failed' }>
        | ProcessCleanupFailure
      >;
      code:
        | 'revo.agent.protocol_failed'
        | 'revo.agent.output_write_failed'
        | 'revo.agent.process_failed'
        | 'revo.agent.process_cleanup_failed';
    }>
  | Readonly<{
      kind: 'process_cleanup';
      primary: ProcessCleanupFailure;
      code: 'revo.agent.process_cleanup_failed';
    }>
  | Readonly<{
      kind: 'result_schema';
      code: 'revo.agent.result_schema_mismatch';
    }>
  | Readonly<{
      kind: 'finalization';
      code: 'revo.agent.scratch_cleanup_failed' | 'revo.agent.output_write_failed';
    }>;

type NormalizedInvocationOutcome =
  | Readonly<{
      status: 'succeeded';
      value: JsonObject;
      evidence: NormalizedInvocationEvidence;
    }>
  | Readonly<{
      status: 'failed';
      failure: NormalizedInvocationFailure;
      evidence: NormalizedInvocationEvidence;
    }>
  | Readonly<{
      status: 'cancelled' | 'timed_out';
      evidence: NormalizedInvocationEvidence;
    }>;
```

The parser-to-public-fault mapping MUST be:

| Parser reason         | Public fault code                |
| --------------------- | -------------------------------- |
| `response_empty`      | `revo.agent.result_missing`      |
| `response_too_large`  | `revo.agent.result_too_large`    |
| `invalid_utf8`        | `revo.agent.result_invalid_json` |
| `invalid_json`        | `revo.agent.result_invalid_json` |
| `response_not_object` | `revo.agent.result_not_object`   |
| `frame_malformed`     | `revo.agent.protocol_failed`     |
| `frame_overflow`      | `revo.agent.protocol_failed`     |
| `duplicate_terminal`  | `revo.agent.protocol_failed`     |
| `missing_terminal`    | `revo.agent.result_missing`      |

The normalized failure evidence MUST retain the exact `ParserFailureReason` even when multiple reasons map to the same public fault code.

The non-parser duplex mapping MUST be:

| Primary                                              | Public fault code                   |
| ---------------------------------------------------- | ----------------------------------- |
| `attach_failed`                                      | `revo.agent.protocol_failed`        |
| `stdin_write_failed`                                 | `revo.agent.protocol_failed`        |
| `stdin_end_failed`                                   | `revo.agent.protocol_failed`        |
| `stdout_sink_failed`                                 | `revo.agent.output_write_failed`    |
| `stderr_sink_failed`                                 | `revo.agent.output_write_failed`    |
| `protocol_sink_failed`                               | `revo.agent.protocol_failed`        |
| `result_schema_failed`                               | `revo.agent.result_schema_mismatch` |
| `process_failed`                                     | `revo.agent.process_failed`         |
| attach, stdin, protocol, or parser operation timeout | `revo.agent.protocol_failed`        |
| stdout or stderr operation timeout                   | `revo.agent.output_write_failed`    |
| `process_cleanup_failed` with any exact cause        | `revo.agent.process_cleanup_failed` |

Attach, stdin, and protocol transport failures MUST map to `revo.agent.protocol_failed`.

Stdout and stderr evidence failures MUST map to `revo.agent.output_write_failed`.

Result-schema failure MUST map to `revo.agent.result_schema_mismatch` and MUST retain bounded `/result` diagnostics.

Nonzero or signalled process exit MUST map to `revo.agent.process_failed`.

A late-confirmed terminal failure whose preserved primary is `process_cleanup_failed` MUST map to `revo.agent.process_cleanup_failed` and MUST retain the exact `ProcessCleanupFailureCause` and bounded evidence.

Scratch cleanup and terminal output publication MAY replace the provisional normalized failure only through the finalization variant and precedence in section 20.

Every accepted terminal result MUST retain copied exit evidence.

Every accepted terminal result MUST retain copied usage when present.

## 16. Active state and acceptance ordering

Start MUST perform the following state transitions in order:

```text
reserved -> preflight -> claiming -> claimed -> resources -> start_attempt_registered
  -> spawn_accepted_io_paused -> identity -> saving -> accepted_handle_created
  -> coordinator_registered -> io_activated -> running
  \-> rejecting -> draining -> rejected
  \-> uncertain_retained
```

Every state before `accepted_handle_created` MUST remain private.

A private state MUST NOT create a public invocation, handle, event, completed record, result lookup, retention entry, or terminal file.

Output claim attempt registration MUST occur before claim dispatch.

Process start attempt registration MUST occur before native spawn dispatch.

After successful claim, cancellation or shutdown MUST be rechecked before resource consumption and before spawn.

No signal MAY be sent before a child exists.

Wall, idle, and the one active-state setup deadline MUST be armed from the exact monotonic `spawnedAt` recorded at native spawn acceptance. No logical state transition, identity completion, save dispatch, acceptance, handle creation, I/O activation, or handle return MAY reset or postpone them.

The process-start attempt, terminal publication authority, bound protocol/stream graph, and timer ownership MUST be attached to the pending-start drain record before native spawn. After the initial save fulfills, acceptance and handle creation MUST atomically transfer that drain record into the accepted lifecycle while I/O remains paused. Coordinator registration and I/O activation MUST then replace the accepted lifecycle's paused live-ownership slot atomically.

The initial `running` snapshot MUST use the authenticated process identity view.

The initial `running` save MUST fulfill before acceptance is eligible.

Exactly one `activeStateOperationTimeoutMs` setup deadline MUST span immediate post-spawn process inspection, fingerprint capture, and fulfillment of the initial `running` save. Coordinator registration and I/O activation occur only after acceptance and do not extend or reset that deadline.

Identity inspection and fingerprinting MUST receive the remaining time to that deadline. After successful identity capture, the initial active-state save MUST be dispatched immediately in the invocation's serialized active-state lane with only the then-remaining time. No fresh active-state operation window MAY be created for that save.

Immediately after identity succeeds, application MUST capture one valid RFC 3339 `startedAt` timestamp for the active snapshot. It is observability data only, MUST NOT contribute to the fingerprint or authorize signalling, and MUST be reused unchanged in the initial save. The initial snapshot process fields MUST be the copied authenticated `pid`, `processGroupId`, and `fingerprint` plus that application `startedAt`.

If the setup deadline wins before identity succeeds, the primary fault MUST be `revo.agent.process_identity_failed`. If it wins after identity succeeds and before the initial save fulfills, the primary fault MUST be `revo.agent.active_state_failed`.

Once the save is dispatched, timeout, cancellation, or rejection MUST treat the row as possibly persisted.

After abort, fulfillment of that same already-dispatched save promise within one additional `activeStateOperationTimeoutMs` reconciliation window MUST be the only confirmation that its mutation is quiescent. That reconciliation window begins only after acceptance has become impossible and MUST NOT extend or restart the single setup deadline.

Save rejection MUST NOT count as quiescence confirmation.

The package MAY dispatch absent-row-safe idempotent removal only after save-fulfillment quiescence and confirmed process cleanup.

The ID reservation MAY be released only after that removal fulfills.

Unknown save quiescence or rejected, timed-out, or unknown removal MUST retain the active-state reconciliation guard and MUST fail the manager closed.

The pending start MUST use one atomic commit for process exit while paused, caller cancellation, wall timeout, idle timeout, identity failure, active-state failure, manager shutdown, and acceptance. The first candidate whose commit succeeds MUST remain primary; no candidate kind has precommit priority. Protocol, parser, schema, valid-result, or I/O-activation outcomes cannot occur in this preacceptance arbiter because package process I/O remains paused.

`accept` MUST be ineligible until identity capture and the initial `running` save have both fulfilled before their deadlines.

When the initial save fulfills, application MUST synchronously compare the monotonic clock with all deadlines, attempt any newly observed candidate commit, check for an earlier committed candidate, and commit `accept` plus handle creation before another await only when none exists. Atomic commit order, not a fixed candidate-kind matrix, decides a race.

A terminal or cancellation candidate committed before acceptance MUST reject start after required drain and MUST NOT become a public result.

Before acceptance, caller cancellation, wall/idle timeout, manager shutdown, identity failure/deadline, child exit while paused, or save failure/deadline MUST clean through the start attempt's live authority. After acceptance, activation and all process/protocol/result candidates belong to the accepted lifecycle and MUST NOT reject `start()`.

Every such cleanup helper MUST fulfill confirmed-or-retained disposition and MUST NOT reject. Confirmed cleanup MUST drain/dispose paused or active I/O as specified in section 11. Retained cleanup MUST keep the ID reservation, active-row reconciliation state when applicable, timer state, I/O handles, protocol/stream graph, and output authority failed closed.

A candidate committed after acceptance MUST enter the accepted lifecycle's terminal arbitration.

Acceptance MUST make the public invocation visible before delivering `invocation.accepted`.

`invocation.accepted` MUST precede `invocation.started`.

An accepted cancellation transition MUST deliver at most one `invocation.cancelling` before `invocation.finished`.

Exactly one process-local `invocation.finished` MUST follow every committed terminal result.

Only `running` and `cancelling` MAY be persisted as active snapshots.

The `cancelling` save MUST be best-effort and MUST NOT delay local signalling.

A failed active-row removal after confirmed process cleanup MUST remain bounded diagnostic evidence and MUST NOT replace the invocation result.

## 17. Preacceptance and postacceptance typed outcomes

The private preacceptance disposition MUST be:

```ts
type PreacceptanceOutcome =
  | Readonly<{ status: 'accepted'; execution: RunningExecution }>
  | Readonly<{
      status: 'rejected';
      fault: AgentFault;
      output: 'unclaimed' | 'quarantined';
    }>
  | Readonly<{
      status: 'rejected_retained';
      fault: AgentFault;
      output: 'possibly_claimed' | 'quarantined';
      claimGuard?: OutputClaimGuard;
      cleanupAuthority?: RetainedCleanupAuthority;
      activeStateUncertain: boolean;
    }>;
```

Both rejected variants MUST surface to the public caller as `AgentManagerError` and no handle.

`rejected_retained` MUST retain the ID reservation and MUST fail the manager closed.

The accepted disposition MUST transfer the original spawn timestamp, running execution, terminal publication authority, active-state lane, and deadlines into the public lifecycle.

The private postacceptance disposition MUST be:

```ts
type PostacceptanceOutcome =
  | Readonly<{ status: 'terminal'; result: AgentInvocationResult }>
  | Readonly<{
      status: 'nonterminal_retained';
      primary: Readonly<{ kind: 'cancelled' }> | DuplexPrimaryFailure;
      authority: RetainedCleanupAuthority;
    }>;
```

`nonterminal_retained` MUST remain observable as an active invocation.

`nonterminal_retained` MUST preserve its active row.

`nonterminal_retained` MUST NOT publish or retain a completed result.

The exact preacceptance fault mapping MUST be:

| Condition                                                                                        | Fault                                                                | Phase                     |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------- |
| uninitialized manager                                                                            | `revo.agent.manager_not_initialized`                                 | `manager`                 |
| closing or closed manager                                                                        | `revo.agent.manager_closed`                                          | `manager` or `starting`   |
| invalid request                                                                                  | `revo.agent.invocation_invalid`                                      | `preflight`               |
| duplicate ID                                                                                     | `revo.agent.invocation_duplicate`                                    | `preflight`               |
| unknown exact agent                                                                              | `revo.agent.agent_unknown`                                           | `preflight`               |
| invalid limits                                                                                   | `revo.agent.limit_invalid`                                           | `preflight`               |
| invalid parameters                                                                               | `revo.agent.parameters_invalid`                                      | `preflight`               |
| invalid permissions                                                                              | `revo.agent.permissions_invalid`                                     | `preflight`               |
| permission denial                                                                                | `revo.agent.permission_denied`                                       | `preflight`               |
| unavailable or incoherent binding                                                                | `revo.agent.strategy_unsupported`                                    | `preflight`               |
| invalid result schema                                                                            | `revo.agent.result_schema_invalid`                                   | `preflight`               |
| invalid environment or secret leak                                                               | `revo.agent.environment_invalid`                                     | `preflight`               |
| invalid workspace                                                                                | `revo.agent.workspace_invalid`                                       | `preflight`               |
| invalid output path or parent                                                                    | `revo.agent.output_path_invalid`                                     | `preflight`               |
| existing output leaf                                                                             | `revo.agent.output_conflict`                                         | `preflight` or `starting` |
| fresh probe failure                                                                              | existing exact `revo.agent.probe_*`                                  | `probing`                 |
| claim create failure                                                                             | `revo.agent.output_write_failed`                                     | `starting`                |
| claim timeout or unknown state                                                                   | `revo.agent.output_write_failed` plus retained guard                 | `starting`                |
| scratch conflict/create/write/flush                                                              | `revo.agent.scratch_failed`                                          | `starting`                |
| redaction-sink or evidence-open failure                                                          | `revo.agent.output_write_failed`                                     | `starting`                |
| preparation timeout or unknown state                                                             | `revo.agent.output_write_failed` plus retained publication authority | `starting`                |
| any postclaim carrier, token, attestation, repeated-bound, or repeated-secret invariant mismatch | `revo.agent.internal` with quarantined output                        | `starting`                |
| spawn failure                                                                                    | `revo.agent.spawn_failed`                                            | `starting`                |
| identity failure                                                                                 | `revo.agent.process_identity_failed`                                 | `starting`                |
| initial active-state failure                                                                     | `revo.agent.active_state_failed`                                     | `starting`                |
| process exit while I/O remains paused                                                            | `revo.agent.process_failed`                                          | `starting`                |
| paused-process descendant cleanup uncertainty                                                    | `revo.agent.process_cleanup_failed` plus retained cleanup authority  | `starting`                |
| caller cancellation before spawn                                                                 | `revo.agent.cancelled` with cleanup not required                     | `starting`                |
| caller cancellation after spawn with confirmed cleanup                                           | `revo.agent.cancelled`                                               | `starting`                |
| wall or idle timeout with confirmed cleanup                                                      | `revo.agent.timeout`                                                 | `starting`                |

If preacceptance cleanup is uncertain, the winning operation fault MUST remain primary and bounded cleanup-uncertain evidence MUST be attached.

If preacceptance cancellation cleanup is uncertain, the primary public fault MUST be `revo.agent.process_cleanup_failed` and cancellation MUST remain bounded cause evidence.

After acceptance, `cleanup_uncertain` MUST remain nonterminal with `revo.agent.process_cleanup_failed` evidence until cleanup is confirmed or shutdown fails.

`revo.agent.shutdown_failed` MUST describe the shared manager-close settlement only and MUST NOT replace an earlier start or invocation fault.

## 18. Deadlines, bounds, and ownership

The numeric contracts MUST be:

| Value                                | Owner                                 |              Minimum |      Default | Hard maximum |
| ------------------------------------ | ------------------------------------- | -------------------: | -----------: | -----------: |
| active-state operation timeout       | manager                               |               100 ms |    10,000 ms |    30,000 ms |
| manager initialization timeout       | manager                               |             1,000 ms |   120,000 ms | 1,800,000 ms |
| output-claim operation timeout       | fixed private policy                  |            10,000 ms |    10,000 ms |    10,000 ms |
| output-preparation operation timeout | fixed private policy                  |            10,000 ms |    10,000 ms |    10,000 ms |
| duplex operation timeout             | fixed private policy                  |            10,000 ms |    10,000 ms |    10,000 ms |
| wall-clock timeout                   | manager default; invocation-lowerable |             1,000 ms | 1,800,000 ms | 1,800,000 ms |
| idle timeout                         | manager default; invocation-lowerable |             1,000 ms |   300,000 ms |   300,000 ms |
| protocol frame bytes                 | fixed private policy                  |            1,048,576 |    1,048,576 |    1,048,576 |
| accepted protocol frames             | fixed private policy                  |               10,000 |       10,000 |       10,000 |
| pending protocol writes              | fixed private policy                  |                   64 |           64 |           64 |
| one nonterminal lifecycle event      | manager default; invocation-lowerable |          1,024 bytes | 65,536 bytes | 65,536 bytes |
| `events.ndjson`                      | manager default; invocation-lowerable | terminal reservation |       16 MiB |       16 MiB |
| `stdout.log`                         | manager default; invocation-lowerable |               64 KiB |        8 MiB |        8 MiB |
| `stderr.log`                         | manager default; invocation-lowerable |               64 KiB |        8 MiB |        8 MiB |
| retained raw response                | manager default; invocation-lowerable |               64 KiB |        1 MiB |        1 MiB |
| retained completed records           | manager                               |                    1 |        1,000 |        1,000 |
| terminal lifecycle event bytes       | fixed runtime policy                  |            2,097,152 |    2,097,152 |    2,097,152 |
| command probe stdout bytes           | fixed runtime policy                  |               65,536 |       65,536 |       65,536 |
| command probe stderr bytes           | fixed runtime policy                  |               65,536 |       65,536 |       65,536 |
| parser line bytes                    | fixed runtime policy                  |            1,048,576 |    1,048,576 |    1,048,576 |
| parser carry bytes                   | fixed runtime policy                  |            1,048,576 |    1,048,576 |    1,048,576 |
| cleanup reconcile timeout            | runtime policy                        |               500 ms |       500 ms |       500 ms |
| retained cleanup retries             | runtime policy                        |                    2 |            2 |            2 |
| process termination grace            | runtime policy                        |             2,000 ms |     2,000 ms |     2,000 ms |
| post-kill group/reap confirmation    | runtime policy                        |               500 ms |       500 ms |       500 ms |
| raw-response preview bytes           | runtime policy                        |               65,536 |       65,536 |       65,536 |

The active-state operation timeout MUST be no greater than the initialization timeout.

The idle timeout MUST be no greater than the wall-clock timeout.

`maxEventsFileBytes` MUST be at least `maxTerminalEventBytes + maxEventBytes + 2`.

Every configurable value MUST be a safe integer within its inclusive range.

The supported production `InvocationClock` MUST use a monotonic elapsed-time source.

A scheduled callback MUST execute at most once.

The returned schedule-cancellation function MUST be idempotent.

An injected deterministic test clock MUST NOT be used as evidence for a supported runtime timing claim.

The argument count MUST be at most 4,096.

One argument MUST be at most 262,144 UTF-8 bytes.

The executable-plus-arguments plain UTF-8 sum MUST be at most 1,048,576 bytes.

The prompt MUST be at most 4 MiB UTF-8.

The raw response MUST retain at most effective `maxRawResponseBytes`, whose canonical default and hard maximum are 1 MiB.

An invocation ID, agent ID, or agent version MUST be at most 256 UTF-8 bytes.

A workspace or output path MUST be at most 16 KiB UTF-8.

Serialized metadata MUST be at most 64 KiB UTF-8.

Serialized parameters and permissions MUST each be at most 256 KiB UTF-8.

The canonical result schema MUST be at most 1 MiB UTF-8.

The child environment MUST retain at most 128 keys and 256 KiB total, with a 128-byte key maximum and 64 KiB value maximum.

Configured redaction secrets MUST contain at most 1,000 values and 64 KiB UTF-8 in total.

Invocation secret entries MUST remain within the environment's 128-key, 64-KiB-per-value, and 256-KiB-total bounds.

After configured-first and invocation-second exact-value deduplication, one registration MUST contain at most 1,128 unique values and 320 KiB UTF-8 in total.

The event-file terminal reservation MUST equal `maxTerminalEventBytes + maxEventBytes + 2`, where `maxTerminalEventBytes` is 2 MiB and the two bytes are newline terminators.

The idle deadline MUST be terminal-only.

Stdout bytes MUST NOT reset idle.

Stderr bytes MUST NOT reset idle.

Protocol frames MUST NOT reset idle.

Subscriber work MUST NOT reset idle.

Filesystem flushes MUST NOT reset idle.

Internal timers MUST NOT reset idle.

The wall deadline MUST begin at successful spawn before identity capture, active-state save, acceptance, or handle return.

The idle deadline MUST begin at the same spawn point and end only at committed terminal state.

_Informative rationale:_ claim, preparation, duplex operation, frame, frame-count, and pending-write values are fixed package-private safety policy rather than additions to the public `AgentManagerLimits` or invocation overrides. The 500 ms reconciliation bound reuses the current post-kill confirmation bound. Two retained retries bound repeated signalling while still permitting shutdown to make one later recovery attempt.

## 19. Retained cleanup retry, reconcile, and quiescence

`RetainedCleanupAuthority` MUST expose only `invocationId`.

It MUST expose no PID, process-group ID, fingerprint, process object, signal method, arbitrary timeout, or arbitrary retry count.

It MUST privately retain the live-owned process/group capability, last exit evidence, one serialized operation lane, the outstanding cleanup promise, retry count, and every not-yet-quiescent timer, active-state reconciliation, output authority, protocol/stream graph, and paused-or-active pipe disposal obligation transferred with that process.

The exact helper results MUST be:

```ts
type CleanupReconciliationResult =
  | Readonly<{ status: 'confirmed_absent'; exit: ProcessExitObservation }>
  | Readonly<{ status: 'owned_group_present' }>
  | Readonly<{ status: 'unknown' }>
  | Readonly<{ status: 'retry_exhausted' }>;

type CleanupRetryResult =
  | Readonly<{ status: 'confirmed_absent'; exit: ProcessExitObservation }>
  | Readonly<{ status: 'still_present' }>
  | Readonly<{ status: 'unknown' }>
  | Readonly<{ status: 'retry_exhausted' }>;

type CleanupQuiescenceResult =
  Readonly<{ status: 'quiescent' }> | Readonly<{ status: 'timed_out' }>;
```

Reconciliation MUST inspect only and MUST finish within 500 ms.

One retained retry MUST send group `SIGTERM` and wait no more than 2,000 ms while inspecting group liveness.

The retry MUST stop the grace wait as soon as group absence is confirmed and MUST NOT send `SIGKILL` after that confirmation.

When and only when the group remains live at the end of the grace, the retry MUST send group `SIGKILL`; after `SIGKILL` it MUST wait no more than 500 ms for group absence and leader reap.

At most two retained retries MAY signal.

A third retry request MUST return `retry_exhausted` without signalling.

Concurrent retry requests MUST share one in-flight retry and MUST NOT send duplicate signals.

Quiescence MUST finish within the fixed private 10-second duplex-operation bound.

All helpers MUST authenticate the authority.

All helpers MUST fulfill their closed union and MUST NOT reject.

Shutdown MUST drain retained cleanup authorities concurrently. Each reconcile, signal, grace, confirmation, reap, active-state, and output-quiescence operation MUST use its own existing public or fixed private bound; shutdown MUST NOT reinterpret `initializationTimeoutMs` as a general close deadline.

For each authority, shutdown MUST quiesce an in-flight operation, reconcile, perform at most one remaining retry in that shutdown pass when the owned group is still present, and reconcile once more.

Confirmed absence MAY proceed to active-row removal and terminal continuation.

For a pre-activation start, confirmed absence MUST close unread pipe handles and dispose the graph without invoking stdout/stderr or downstream callbacks. For an activated start, confirmed absence MUST drain only already-issued bounded callbacks before disposal; it MUST NOT restart a stopped pump.

Terminal continuation after retained cleanup MUST reuse the preserved primary and evidence.

Terminal continuation after retained cleanup MUST NOT rerun parser, schema, or primary-failure arbitration.

If the preserved primary is `process_cleanup_failed`, continuation MUST normalize it to `revo.agent.process_cleanup_failed` with the preserved exact cause, retained natural-exit evidence, and copied exit observation.

For an accepted invocation, shutdown MAY complete that normalization, terminal publication, process-local commit, and output quiescence under those operation-owned bounds. For a preacceptance rejection, shutdown MUST NOT publish a result or lifecycle line; after cleanup, active-row reconciliation, and output quiescence it MAY release the retained ID reservation.

An operation-owned timeout, unknown state, still-present state, or retry exhaustion MUST reject shared shutdown and retain the same authority.

Retry exhaustion MUST prohibit further package signalling.

Later inspection MAY still confirm external cleanup.

## 20. Terminal finalization and publication precedence

An accepted invocation MUST finalize in this order:

1. confirm natural-exit or cancellation process-group cleanup and leader reap;
2. attempt active-row removal;
3. normalize the confirmed duplex observation without reparsing;
4. attempt scratch cleanup;
5. flush bounded redacted stdout, stderr, and pending nonterminal lifecycle evidence;
6. replace the provisional outcome with `revo.agent.scratch_cleanup_failed` when scratch cleanup failed;
7. otherwise replace the provisional outcome with `revo.agent.output_write_failed` when an earlier pre-result evidence operation failed;
8. publish a failure-only raw response whenever normalization supplied authentic `RawFinalResponseEligibility`, including a zero-byte file for `response_empty` or `missing_terminal`;
9. if raw-response publication fails, replace the provisional outcome with `revo.agent.output_write_failed` and omit the raw-response filename;
10. construct the bounded terminal result and include the raw-response filename only after successful non-replacing raw publication;
11. publish that terminal result to `result.json` without replacement;
12. if result publication fails, create the same bounded in-memory `revo.agent.output_write_failed` result with `files.result` absent and do not recursively retry result persistence;
13. add the immutable in-memory completed record and apply FIFO eviction;
14. best-effort append and flush exactly one lifecycle-only `invocation.finished` line;
15. retain bounded technical evidence when that append fails without mutating the committed result;
16. deliver exactly one process-local lifecycle-only `invocation.finished`; and
17. resolve handle and manager waiters.

A failed raw-response publication MUST count as a pre-result evidence failure.

A raw-response publication failure MUST remove the raw-response filename from the final in-memory manifest.

`raw-final-response.txt` MUST be present only for a failed normalized outcome in ADR-0003's exact result-extraction, result-parsing, or result-schema-validation partition, with authentic eligibility and successful raw publication. Zero retained bytes do not skip publication for an eligible outcome.

Within that partition, `response_too_large`, `invalid_utf8`, `invalid_json`, `response_not_object`, `duplicate_terminal`, and `result_schema_failed` MAY publish when their exact associated candidate bytes are retained. `response_empty` and `missing_terminal` MUST publish an empty `raw-final-response.txt` when their eligible failure reaches raw publication.

`raw-final-response.txt` MUST be absent for `frame_malformed`, `frame_overflow`, success, cancellation, timeout, transport, process, output, cleanup, internal failure, or ineligible evidence. Zero retained bytes alone MUST NOT make an eligible extraction failure absent.

No broad “any failed outcome with raw bytes” rule is conformant. Any future expansion of this partition requires an explicit amendment to ADR-0003 rather than reinterpretation of this specification.

A scratch-cleanup failure MUST take precedence over another provisional execution/result fault.

A pre-result output failure MUST take precedence only when scratch cleanup succeeded.

A result-publication failure MUST produce in-memory `output_write_failed` with no `result.json` and MUST NOT rewrite an already committed file.

A terminal NDJSON append failure MUST NOT replace or mutate the in-memory result.

Late output failure MUST NOT strand process-local completion.

Before process-local terminal-event delivery, `getResult(invocationId)` MUST observe the completed record.

The terminal event MUST carry no result, fault, diagnostics, output bytes, raw response, usage, exit, or file manifest.

Exactly-one terminal event delivery is process-local and MUST NOT be represented as a guarantee that the terminal NDJSON line reached disk.

## 21. Shutdown ordering

The first shutdown call MUST atomically close new work and create one shared completion.

Concurrent and later shutdown calls MUST return the same completion.

Shutdown MUST cancel and drain pending claim attempts, output-preparation attempts, process-start attempts, spawn-accepted paused-I/O starts, running executions, accepted invocations, probes, active-state lanes, terminal publication authorities, retained claim guards, and retained cleanup authorities.

A claim attempt preregistered before close MUST be included even when its syscall has not been dispatched.

An output-preparation attempt preregistered before close MUST be included even when its first filesystem mutation has not been dispatched.

A process-start attempt registered before close MUST be included even when native spawn has not dispatched. A spawn accepted before close MUST be included even when identity, active-state save, acceptance, or I/O activation has not occurred.

Shutdown MUST drain independent items concurrently.

`initializationTimeoutMs` MUST bound only initialization. When shutdown interrupts pending initialization, it MUST atomically close new work, abort the current abortable recovery operation, start no further recovery rows, and use only that initialization's existing remaining deadline while still confirming termination of every recovery process already signalled, as AgentManager v1 requires. All other shutdown drainage MUST run concurrently under the applicable operation-owned public or fixed private bounds; there is no shared general shutdown deadline.

Successful shutdown MUST require confirmed absence and reap of every live-owned invocation and probe process.

Successful shutdown MUST require every accepted invocation to reach terminal process-local completion and output quiescence.

A retained claim or cleanup authority unresolved after its applicable bounded drainage MUST reject shutdown with `revo.agent.shutdown_failed`.

An accepted invocation whose cleanup remains uncertain MUST remain active and nonterminal.

A rejected preacceptance start with retained authority MUST remain publicly unknown but its ID MUST remain unavailable.

After `shutdown_failed`, the manager MUST remain permanently closed and failed closed.

The consumer MUST NOT construct a replacement manager in the same supervision domain only while manager-owned process cleanup remains unresolved. Output uncertainty MUST quarantine the affected invocation ID and output path without imposing a global replacement ban. Active-state uncertainty MUST preserve the affected ID/row for consumer-backed reconciliation by a fresh manager; it does not authorize the failed manager to continue.

## 22. Compatibility and migration requirements

The current private `PreparedLaunch` visible fields `pin`, `executable`, and `reportedVersion` MUST be preserved.

`PreparedLaunch` MUST gain authentic branding before it can contribute authority to `PreparedInvocation`.

The current execution call `start(snapshot, preparedLaunch)` MUST be replaced atomically by `start(preparedExecution)`.

No production compatibility overload MAY permit both execution-call shapes.

Migration MUST NOT change the public `StartAgentInvocation`, `AgentManagerLimits`, or `AgentFaultCode` surfaces owned exclusively by AgentManager v1. B+ migration changes package-private carriers and adapters only.

Current test fakes MUST migrate to package-owned authentic fixtures and MUST NOT construct authority-bearing carriers structurally.

The current process request fields `cwd`, `executable`, `args`, `environment`, `shell:false`, `stdout`, and `stderr` MUST be preserved.

The process request MUST add informational `invocationId`, authentic branding/token binding, and `stdin:'pipe'`.

The live process MUST add its bounded `ProcessInputSink`.

The current lower `ProcessSupervisionPort.start(request): Promise<LiveOwnedProcess>` shape MUST migrate atomically to preregistered `ProcessStartAttempt` plus synchronous `beginStart(attempt, request): void`. No overload MAY retain a direct throwing, live-only, or unregistered post-spawn result path.

The platform adapter MUST create authentic live cleanup authority immediately after native spawn acceptance so post-spawn identity failure cannot escape without confirmed cleanup or `RetainedCleanupAuthority`.

The process adapter MUST return spawn-accepted I/O paused. Eager stdout/stderr pumping before sole-coordinator registration and dual eager/paused compatibility paths are nonconformant.

The current ignored-stdin spawn behavior MUST be removed before `stdin` or protocol delivery can be conformant.

Protocol redaction preparation MUST migrate to the authentic deferred destination binding in section 10; creating a protocol session during output preparation, using a dummy sink, buffering before bind, or keeping both eager and deferred paths is nonconformant.

The current terminal union carrying only completed raw bytes, cancelled, or failed MUST be removed.

It MUST NOT remain as an alias or second completion path.

The current normalization pass that decodes and reparses raw bytes MUST be removed after parser/coordinator migration.

Normalization MUST consume only authentic duplex terminal observations.

The current flat normalized failure union MUST be replaced or extended so the exact parser reason is never lost.

The current output method `recordTerminalResult` MUST migrate to capability-authenticated `publishTerminalResult` with non-replacing `result.json` semantics.

The current output method `recordEvent` MUST migrate to capability-authenticated `appendLifecycleEvent` with bounded lifecycle-only NDJSON semantics.

The output port MUST add capability-authenticated failure-only raw-response publication, scratch cleanup, and quiescence.

No lifecycle implementation MAY delete the old output methods before their terminal publication and event responsibilities are represented by the new capability contract.

No lifecycle implementation MAY keep both old and new publication authorities active.

The completed-record-before-terminal-event invariant MUST be preserved.

The terminal-event-failure-does-not-replace-result invariant MUST be preserved.

Existing environment capture, single secret-registration path, streaming redaction, bounded output guards, fresh launch proof, Codex permission behavior, and Codex JSONL semantics MUST be adapted rather than duplicated.

The provider-neutral real-process harness MUST validate the generic contract before Native Codex conformance is claimed.

Native Codex, Native Claude, and ACP compatibility MUST remain separate evidence claims.

## 23. Conformance obligations

A conforming implementation MUST prove all of the following with automated contract or integration evidence:

- one registry read and exact agent ID/version/digest binding;
- complete installed-binding and coherence rejection;
- deterministic preclaim failure before filesystem mutation;
- exact registered-secret substring rejection only for prospective argv and scratch payloads, mapped to existing `revo.agent.environment_invalid`;
- read-only admission and exclusive absent-leaf claim;
- no runtime filesystem-cell admission gate or B+-specific `revo.agent.platform_unsupported` mapping;
- preregistered claim settlement and quiescence before dispatch;
- claim timeout with the identical retained guard in settlement and quiescence;
- late claim settlement and bounded reconciliation;
- fixed scratch paths, owner-only modes, exact bytes, flush-before-attestation, and symlink/conflict rejection;
- pre-established output authority, bounded preparation settlement/quiescence, identical authority on every rejection or uncertainty, late disposal, and shutdown drainage;
- output-port-only redaction/raw-sink construction and one-use security/redaction transfer;
- one authentic deferred protocol destination, zero pre-bind buffering, exact one-use bind, double-bind quarantine, and disposal on every path;
- authentic carriers, cross-invocation rejection, double-consume rejection, and source-reference removal before transfer;
- direct spawn with piped stdin and backpressure;
- preregistered process-start settlement/quiescence proving spawn failure has no child and every post-spawn rejection has confirmed cleanup or authentic retained authority;
- wall, idle, and one active-state setup deadline armed at actual spawn, with identity/fingerprint and initial save sharing the one active-state window;
- zero-callback paused process I/O, sole-coordinator registration before one-use activation, bounded pump backpressure, and all-path paused/active disposal;
- independent stdout, stderr, and protocol redaction state;
- no raw byte path to parser or evidence;
- every exact parser reason, including `missing_terminal`;
- one duplex coordinator, atomic first-committed-candidate arbitration with no precommit priority, and no competing completion authority;
- process identity view authenticity without signalling surface;
- copied usage, exit, raw-response, parser-reason, and `/result` schema evidence through normalization;
- confirmed cleanup before terminal commit;
- retained cleanup reconciliation, two-retry limit, quiescence, and shutdown failure;
- natural-exit `process_cleanup_failed` cause preservation, TERM early-exit, conditional KILL, retained evidence, late confirmation, and normalization continuation;
- paused spawn, identity inspection, and initial active-state save before acceptance/handle creation, followed by coordinator registration and I/O activation;
- no public state for every preacceptance rejection;
- terminal-only idle and spawn-based wall deadline;
- ADR-0003-partitioned non-replacing `raw-final-response.txt`, including a zero-byte file for `response_empty` and `missing_terminal`, and non-replacing `result.json` publication;
- completed record before terminal event;
- terminal NDJSON append failure that does not mutate the result;
- 64 KiB fixed stdout and stderr caps for every command probe;
- initialization-only `initializationTimeoutMs` plus concurrently bounded shutdown operations with no general shared close deadline;
- replacement prohibition only for unresolved manager-owned process cleanup in the same supervision domain, with affected output-path quarantine and fresh-manager active-state reconciliation; and
- honest disposal: mutable byte zero-fill and reference release without a JavaScript-string erasure claim.

A Linux/local-`ext4` claim MUST be backed by native process and filesystem evidence for that exact cell.

Linux evidence MUST NOT be generalized to macOS.

No Windows claim is conformant under this specification.

Missing filesystem, provider, credential, CI, Sonar, or native-host evidence MUST be reported as blocked or skipped and MUST NOT be reported as passed.

## 24. Decision and implementation status

ADR-0013 and this package-private contract are accepted and implemented. The provider-neutral root API is present;
supported-cell declaration and later-provider compatibility remain separate gates. Native
Codex compatibility is established only by its exact adapter tests and evidence, not by this specification alone.

## 25. Residual risks

- A dispatched claim may remain unknowable after its fixed bounded shutdown drainage. The accepted control is retained authentic authority, failed-closed manager state, quarantine of the affected ID/path, continued stable-ancestor warranty, and external reconciliation without a global replacement ban.
- A process group may remain present after bounded retries. The accepted control is nonterminal retention, no false result, `shutdown_failed`, and host-level consumer escalation.
- Active-state settlement may remain uncertain after a failed start. The accepted control is affected-ID retention, manager fail-closed behavior, and consumer-backed reconciliation by a fresh manager; it does not prohibit replacement after process cleanup is resolved.
- JavaScript strings and copies made by Node or the operating system cannot be physically zeroized. The accepted control is minimum reference lifetime, private one-use transfer, early reference clearing, and zero-fill only for owned mutable byte buffers.
- Provider output may be malformed, adversarial, or omit a terminal frame. The accepted control is independent streaming redaction, exact parser taxonomy, strict bounds, one terminal authority, and typed failure.
- Non-replacing result or terminal-event publication can fail after process completion. The accepted control is immutable process-local completion plus an explicitly incomplete consumer audit record.
- The first public contract may be proven against only the provider-neutral harness and Native Codex. Provider neutrality depends on the harness remaining provider-free and on later adapters requiring a new approved decision rather than silently changing the contract.
- Pathname-based filesystem safety depends on the consumer's stable-ancestor warranty. This specification does not claim hostile-ancestor safety.
