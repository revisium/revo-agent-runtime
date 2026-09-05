<div align="center">

# Revo Agent Runtime

Protocol-neutral discovery and supervised ACP v1 agent execution for Node.js.

![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![ACP v1](https://img.shields.io/badge/ACP-v1-6E56CF)
![MIT](https://img.shields.io/badge/license-MIT-22C55E)
[![CI](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml?query=branch%3Amaster)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)

</div>

## Status and installation

The package metadata is prepared for the public alpha release
(`0.2.0-alpha.0`) with npm provenance. This migration pull request does not
publish the package; install dependencies from this repository while release
publication remains deferred. Runtime requires Node.js `>=24.15.0 <25`;
repository development uses pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
```

The public API is exposed from the package root; deep imports are unsupported.

The caller owns definition persistence and active-state storage. The runtime
accepts definitions returned by discovery or supplied from the caller's store;
it never persists either collection.

## Discover available definitions

```ts
import { discoverAgents } from '@revisium/revo-agent-runtime';

const discovery = await discoverAgents();
console.log(discovery.definitions.map(({ id, version }) => `${id}@${version}`));
console.log(discovery.diagnostics);
```

Definitions are ready to register when discovery can verify their local launch
shape; they do not prove provider authentication or prompt readiness.

## Create, initialize, and subscribe

```ts
import { createAgentManager, discoverAgents } from '@revisium/revo-agent-runtime';

const { definitions } = await discoverAgents();
const manager = createAgentManager({
  definitions,
  activeStateSink: {
    save: (snapshot, context) => activeStateStore.save(snapshot, context),
    remove: (invocationId, context) => activeStateStore.remove(invocationId, context),
  },
  sessions: {
    activeStateSink: sessionStateStore,
    eventSink: sessionEventStore,
  },
});

await manager.initialize({
  invocations: await activeStateStore.list(),
  sessions: await sessionStateStore.list(),
});
const unsubscribe = manager.subscribe({}, (event) => eventSink.publish(event));
```

The listener receives only lifecycle events: accepted, started, cancelling, and
finished. A finished event means the immutable result is available.

## Inspect configuration and select a model

```ts
const agent = manager.listAgents()[0];
if (agent === undefined) throw new Error('No discovered agent is available.');

const catalog = await manager.inspectConfiguration({
  agent: agent.agent,
  workspace: { directory: workspaceDirectory },
});

const configuration =
  catalog.model === undefined
    ? undefined
    : {
        catalogRevision: catalog.catalogRevision,
        selections: { [catalog.model.optionId]: catalog.model.currentModel },
      };
```

Catalogs are immutable, session-scoped snapshots. `start()` validates selections
again in its fresh session, so stale or unavailable values fail before a prompt.

## Start and read a structured result

```ts
const handle = await manager.start({
  agent: agent.agent,
  configuration,
  invocationId: crypto.randomUUID(),
  output: { directory: outputDirectory },
  parameters: {},
  permissions: {},
  prompt: 'Return exactly {"ok": true}.',
  result: {
    schema: {
      additionalProperties: false,
      properties: { ok: { const: true, type: 'boolean' } },
      required: ['ok'],
      type: 'object',
    },
  },
  workspace: { directory: workspaceDirectory },
});

const result = await handle.result();
if (result.status === 'succeeded') console.log(result.value.ok); // true
```

Expected execution failures resolve to a terminal result. Construction and
pre-acceptance failures throw `AgentManagerError`.

## Keep a hot multi-turn session

```ts
const session = await manager.sessions.open({
  agent: agent.agent,
  output: { directory: sessionOutputDirectory },
  parameters: {},
  permissions: {},
  sessionId: 'dlg_01',
  workspace: { directory: workspaceDirectory },
});

const first = await session.send({ prompt: 'Remember 73.', turnId: 'trn_01' });
await first.result();
const second = await session.send({ prompt: 'What number?', turnId: 'trn_02' });
console.log(await second.result());
await session.close();
```

Session events expose assistant messages, tool/plan/usage updates, permission
choices, and structured questions including multi-select answers. The consumer
owns the durable event and active-state stores; the runtime owns the hot process
and drains it during shutdown.

## Cancel and shut down

```ts
await handle.cancel('The caller no longer needs this result.');
unsubscribe();
await manager.shutdown();
```

Cancellation is idempotent. Shutdown drains owned work and confirms cleanup
before it resolves.

## Further reading

- [API](./docs/API.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Providers](./docs/PROVIDERS.md)
- [Roadmap](./docs/ROADMAP.md)
- [Third-party bridge notices](./THIRD_PARTY_NOTICES.md)
