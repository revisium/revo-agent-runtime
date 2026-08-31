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
});
```

`definitions` and `activeStateSink` are required. Definitions are validated,
canonicalized, copied, frozen, and registered by exact `{ id, version }`
identity. `ActiveInvocationStateSink` is caller-owned: the manager serializes
its `save` and `remove` calls but never reads it.

Call `initialize(snapshots)` before other manager operations. It reconciles
caller-supplied active snapshots and returns after initialization completes.

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
