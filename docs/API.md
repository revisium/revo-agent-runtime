# API

`@revisium/revo-agent-runtime` exports only its package root. Deep imports are
private. The root exports `discoverAgents`, `createAgentManager`,
`AgentManagerError`, and the public TypeScript contracts.

## Discovery

```ts
const result = await discoverAgents(options);
```

`AgentDiscoveryResult` contains:

- `definitions`: immutable `AgentDefinitionInput` values suitable for manager
  construction;
- `diagnostics`: bounded detector diagnostics;
- `modelObservations`: result-scoped credential-free observations, keyed by
  detector and definition index.

Discovery is deterministic for the same detector set and observations. It does
not persist definitions, start a session, read credentials, install a CLI, or
establish account readiness. `DiscoverAgentsOptions` can add or disable
detectors, pass an abort signal, and provide explicit system executable
overrides.

## Manager construction

```ts
const manager = createAgentManager({
  definitions,
  activeStateSink: { save, remove },
  limits,
  redaction: { secrets },
  sessions: {
    activeStateSink: { save: saveSession, remove: removeSession },
    eventSink: { append: appendSessionEvent },
  },
});
```

`definitions` and `activeStateSink` are required. Definitions are validated,
canonicalized, copied, frozen, and registered by exact `{ id, version }`
identity. `ActiveInvocationStateSink` is caller-owned: the manager serializes
its `save` and `remove` calls but never reads it.

Call `initialize(snapshots)` before other manager operations. Pass the legacy
invocation array or `{ invocations, sessions }`. Initialization reconciles
caller-supplied active rows and returns only after recovery completes. Session
recovery never attaches to an unknown live process: it confirms absence,
identity mismatch, or termination before owner-fenced row removal, and fails
closed when cleanup or ownership is ambiguous.

## Manager methods

| Method                                           | Behavior                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `listAgents()` / `getAgent(agent)`               | Read registered descriptors.                                              |
| `probeAgent(agent)`                              | Perform fresh executable and version preflight.                           |
| `inspectConfiguration(request, context?)`        | Open one bounded session and return its normalized configuration catalog. |
| `subscribe(filter, listener)`                    | Observe lifecycle events and receive an unsubscribe function.             |
| `start(request, context?)`                       | Accept an invocation and return its handle.                               |
| `listInvocations(filter?)` / `getInvocation(id)` | Read active and retained terminal snapshots.                              |
| `getResult(id)` / `waitForResult(id)`            | Read or await a terminal result.                                          |
| `cancel(id, reason?)`                            | Request idempotent cancellation.                                          |
| `shutdown(reason?)`                              | Cancel accepted work and wait for confirmed quiescence.                   |

## Long-lived sessions

`manager.sessions` is the consumer-facing facet for one hot provider process
across multiple turns. It is always present. Without `sessions` construction
options, discovery remains available through `listAgents()`, while mutating
session operations reject with `revo.agent.session_state_unavailable`.

```ts
await manager.initialize({
  invocations: await invocationStateStore.list(),
  sessions: await sessionStateStore.list(),
});

const session = await manager.sessions.open({
  agent: { id: 'codex-acp', version: '1.7.0' },
  output: { directory: sessionOutputDirectory },
  parameters: {},
  permissions: {},
  sessionId: 'dlg_01',
  workspace: { directory: workspaceDirectory },
});

const first = await session.send({ prompt: 'Remember 73.', turnId: 'trn_01' });
await first.result();
const second = await session.send({ prompt: 'What number?', turnId: 'trn_02' });
const result = await second.result();
await session.close();
```

`AgentSessions` provides `listAgents`, `open`, `resume`, active `get`, `inspect`,
and `list`, terminal `getTerminal` and `listTerminal`, plus `respond` and
`cancel`.
`AgentSession` provides `send`, `respond`, `checkpoint`, `hibernate`, `close`,
and `cancel`. A turn result is `completed`, `failed`, `cancelled`, `timed_out`,
or `interrupted`. Passing an `AbortSignal` to `send()` cancels that turn; manager
shutdown cancels and drains all sessions it owns.

The session event sink receives ordered accepted/opened, turn, assistant
message, tool, plan, usage, interaction, checkpoint, hibernation, and terminal
events. Permission responses select one provider option. Structured input
responses support text, number, boolean, single-select, and multi-select values,
including several questions in one request. The consumer persists this journal
and decides how and when a human answers it.

Capabilities are negotiated per opened session. Check them before relying on
interactions, update kinds, cancellation, or native resume. `checkpoint()`,
`hibernate()`, and `resume()` do not synthesize replay: native continuation is
available only when both the definition and provider advertise it.

### Command and deadline semantics

Only one turn may be active in a session. A cancellation result of `requested`
acknowledges the request, not completion: await `turn.result()` before sending
another turn. The runtime waits for the original provider prompt to settle.
If cancellation cannot be confirmed within its bounded control-operation
deadline, the turn fails and the session closes with process cleanup; the
uncertain provider is never reused for another turn.

Turn IDs are unique for the lifetime of the logical session, including native
continuations. Duplicate IDs reject with `revo.agent.turn_duplicate`; they do
not replay a result or send another prompt. The ledger retains at most 10,000
accepted IDs and then rejects new turns with
`revo.agent.session_identity_capacity`. Checkpoint byte limits still apply to
the complete continuation envelope. A resume rejected for capacity before
admission does not consume its token; a token accepted for resume is once-only.

Calling `cancel()` on a completed turn returns `already_completed` with its
result, including after subsequent turns. Repeated terminal session
`close()`/`cancel()` calls return `already_terminal`. Other commands on a terminal
handle reject with `revo.agent.session_closed`; commands unavailable during a
transition reject with `revo.agent.session_busy` rather than remaining pending.
Opening sessions can be cancelled or answered through
`manager.sessions.cancel(id)` / `respond(id, request)` before `open()` resolves.

`operationTimeoutMs` bounds individual control operations, not the whole agent
turn. Session wall-clock and inactivity deadlines bound long-running work.
While a human interaction is pending, inactivity timing is paused; the
wall-clock deadline still applies. An unexpected provider-process exit also
ends the session without waiting for a new consumer command.

Snapshots, turn results, terminal records, events, and sink preconditions are
owned immutable values. Manager `redaction.secrets` and explicit launch-context
secrets protect provider presentation text, journal metadata, results, and
process output. Opaque identities and protocol values are not rewritten: if
they contain a declared secret, delivery fails closed. Do not put credentials
in identifiers or consumer metadata. Launch preparations and buffered output
are released after terminal quiescence independently of terminal-record
retention. Output that arrives after release is ignored.

### Durable events and consumer subscriptions

Session events are delivered through `sessions.eventSink`, not
`manager.subscribe()` (which observes invocations). The consumer owns storage,
replay, and subscriber fan-out. Publish to subscribers only after committing
the append. A listener failure must not roll back that durable append.

`append(event, { expected, signal })` must atomically verify `expected` and
append the event. `empty` requires an empty journal; `cursor` requires the
matching last event; `hibernation_token` additionally checks and claims the
resume-token identity/digest against the matching predecessor. A read followed
by an unrelated write is not an atomic check. For example, a consumer can map
the contract onto its own transactional storage API:

```ts
const eventSink = {
  append: (event, { expected, signal }) =>
    journal.transaction(
      async (tx) => {
        if (!(await tx.matches(event.sessionId, expected))) {
          return { state: 'conflict' };
        }
        await tx.appendAndClaimContinuation(event, expected);
        return { state: 'appended' };
      },
      { signal },
    ),
};
```

The journal/transaction methods above are consumer-defined, not runtime APIs.
Cancellation of the append signal does not prove that a write was rolled back;
the sink must report the actual outcome, and the runtime fails closed if that
outcome remains unknown. Recovery uses owner-fenced active-state snapshots;
it does not reconstruct an agent conversation from the event journal.

## Configuration

`inspectConfiguration()` returns an immutable
`AgentConfigurationCatalog`: a definition pin, launch evidence, catalog
revision, select/boolean options, and an optional model view. Select values are
opaque strings; a provider may use an empty string as an explicit value.

Pass a catalog revision and explicit selections to `start()`:

```ts
configuration: {
  catalogRevision: catalog.catalogRevision,
  selections: { model: 'provider/model', reasoning_effort: 'high' },
}
```

Each invocation opens a fresh session. Selections are validated and applied in
order against that session's current option list. A missing value fails before a
prompt with `revo.agent.configuration_value_unsupported`; a missing value from
a changed supplied revision fails with `revo.agent.configuration_stale`. The
runtime does not substitute a default, latest, alias, or nearest model.

## Invocation and result

`StartAgentInvocation` requires an invocation id, exact agent reference,
workspace, prompt, parameter and permission records, output directory, and a
JSON Schema for the expected top-level object. It may include metadata,
configuration selections, and tighter per-invocation limits.

`start()` returns an `AgentInvocationHandle` with `invocationId`, a definition
pin, `result()`, and `cancel()`. `result()` resolves to one of `succeeded`,
`failed`, `cancelled`, or `timed_out` after process cleanup and terminal output
publication. A successful value is a schema-valid object. Failed results carry
a typed `AgentFault`; eligible parsing or schema failures can include bounded,
redacted raw-response diagnostics.

The runtime claims the output directory exclusively and publishes bounded
`events.ndjson`, `stdout.log`, `stderr.log`, and terminal `result.json` files.
`result.json` is present for succeeded, cancelled, and timed-out results.

## Events, cancellation, and errors

The event stream contains only `invocation.accepted`, `invocation.started`,
`invocation.cancelling`, and `invocation.finished`. Events never expose provider
updates, output, permissions, diagnostics, faults, or result values. Listener
failure cannot alter an invocation result.

Only one terminal result commits. Cancellation requests a provider cancellation
when available, while local process termination and reap remain authoritative.
Expected execution failures resolve through the handle; invalid construction,
manager operations, and pre-acceptance starts throw `AgentManagerError` with an
`AgentFault`.
