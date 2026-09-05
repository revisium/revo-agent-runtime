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
