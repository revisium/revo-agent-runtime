<div align="center">

# @revisium/revo-agent-runtime

**A portable runtime and process-local manager for exact, versioned AI-agent invocations.**

[![CI](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> This repository is in bootstrap. The npm package is not published, its root export is intentionally empty, and the API
> below is a target specification rather than available code.

## About

`@revisium/revo-agent-runtime` will execute one exact native command-line or ACP agent invocation and expose its lifecycle,
bounded redacted events, files, cancellation, shutdown, usage, typed failures, and schema-validated JSON result through one
framework-independent `AgentManager`.

## Quick start

This target-only example assumes the consumer owns a complete versioned definition and result schema. See the
[expanded consumer example](./docs/examples/consumer.md) for the definition and environment setup.

```ts
import { createAgentManager } from '@revisium/revo-agent-runtime';

import { codexDefinition, roleResultSchema } from './agents/codex.js';

const manager = createAgentManager({ definitions: [codexDefinition] });

const unsubscribe = manager.subscribe({}, (event) => {
  if (event.type === 'invocation.output') {
    process.stdout.write(event.text);
  }
});

const handle = await manager.start({
  invocationId: attempt.id,
  agent: { id: 'codex', version: '1.0.0' },
  prompt: 'Implement issue #42 and return the requested JSON object.',
  workspace: { directory: workspace.path },
  parameters: { model: 'gpt-5' },
  permissions: { mode: 'workspace-write', network: false },
  result: { schema: roleResultSchema },
  output: { directory: attempt.agentOutputDirectory },
});

// Optional: stop the agent process through the same lifecycle contract.
// await handle.cancel('Pipeline cancelled');

const result = await handle.result();
const lateLookup = manager.getResult(handle.invocationId);

consumeResult(result, lateLookup);
unsubscribe();
await manager.shutdown('Consumer is stopping');
```

- `subscribe({})` observes future events for every invocation; filter by `invocationId` for one.
- `invocation.output` carries bounded redacted live stdout/stderr events.
- The manager records `events.ndjson`, `stdout.log`, `stderr.log`, and `result.json` under `output.directory`.
- `result()` waits for the terminal result; `getResult()` retrieves a retained result after completion.
- `cancel()` stops one invocation; `shutdown()` closes the manager and drains every accepted invocation.
- Success is a top-level JSON object validated against the supplied draft 2020-12 schema. There is no text-success result.

## Data-driven agents

Agents are versioned JSON data validated against the `AgentDefinition` schema. A definition chooses launch arguments,
delivery, parameter and permission schemas, capabilities, and package-owned execution strategies.

Definitions may select only protocol drivers, result parsers, and permission strategies implemented by this package. Adding
an agent is data-only when those strategies already support it. A new protocol, parser, or permission behavior requires
package code, conformance tests, and a new package release.

```text
AgentDefinition = data
protocol/parser/permission strategy = package code
```

Non-exhaustive conceptual excerpt:

```json
{
  "id": "codex",
  "version": "1.0.0",
  "protocol": {
    "driver": "native/stdio-v1",
    "resultParser": "codex-jsonl/v1",
    "permissionStrategy": "codex-cli/v1"
  }
}
```

The complete definition set is supplied at construction and sealed. V1 has no runtime registration, latest-version lookup,
or fallback selection; construct a new manager for a new definition set.

## Complete target API

This is the complete consumer surface. Supporting types and exact behavior are normative in the
[AgentManager v1 draft specification](./docs/specs/agent-manager-v1.spec.md).

```ts
export declare function createAgentManager(options: AgentManagerOptions): AgentManager;

export declare class AgentManagerError extends Error {
  readonly fault: AgentFault;
}

export interface AgentManager {
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

export interface AgentInvocationHandle {
  readonly invocationId: string;
  readonly pin: AgentExecutionPin;
  result(): Promise<AgentInvocationResult>;
  cancel(reason?: string): Promise<CancelInvocationResult>;
}
```

## Responsibility boundary

The package owns:

- immutable definition validation, exact registry reads, executable probes, and execution pins;
- native and ACP process lifecycle, events, files, structured results, cancellation, shutdown, and reaping;
- package-owned protocol, result-parser, and permission strategies;
- bounds and redaction before subscriber delivery or file writes.

The consumer owns:

- definition storage and rollout plus exact agent, model, prompt, workspace, permission, and result-schema selection;
- invocation ids and any run/step/attempt model, scheduling, retry, pipeline, gate, or product verdict;
- output path construction, durable indexing, retention, restart recovery, and user-facing log projection;
- credential selection, billing, Git, GitHub, and other deterministic system operations.

## Documentation

- [AgentManager v1 specification](./docs/specs/agent-manager-v1.spec.md) — exact target types, lifecycle, files, errors, and
  invariants.
- [Internal module structure](./docs/specs/internal-module-structure.spec.md) — accepted internal layering and module rules;
  it does not create a public export.
- [Architecture](./docs/architecture.md) — implementation structure, dependency direction, and ownership boundaries.
- [Expanded consumer example](./docs/examples/consumer.md) — complete target definition and invocation setup.
- [ADRs and documentation index](./docs/README.md) — accepted decisions and repository policies.
- [Testing](./docs/testing.md) — proof layers and required implementation coverage.

## Requirements

- Node.js 24 (`>=24.11.1 <25`)
- pnpm 11.13.0 through Corepack
- Docker only for the local SonarCloud parity check

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

| Command                    | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `pnpm format:check`        | Verify formatting                                          |
| `pnpm lint`                | Run type-aware Oxlint and TypeScript diagnostics           |
| `pnpm test`                | Run every currently owned Vitest lane                      |
| `pnpm test:architecture`   | Prove allowed boundaries and representative violations     |
| `pnpm test:cov`            | Run tests with v8 coverage                                 |
| `pnpm build`               | Build ESM JavaScript and TypeScript declarations           |
| `pnpm verify:package`      | Validate the exact tarball, types, ESM, and denied imports |
| `pnpm verify:architecture` | Run the committed architecture verification harness        |
| `pnpm verify`              | Run the complete local CI gate                             |
| `pnpm ci:local:sonar`      | Verify, analyze with Sonar, and inspect open branch issues |

## SonarCloud

Copy `.env.sonar.example` to an ignored `.env.sonar`, provide `SONAR_TOKEN`, and run `pnpm ci:local:sonar`. Alternatively,
set `SONAR_ENV_FILE=/absolute/path/to/.env.sonar`. CI runs verification before analysis; pull requests also wait for the
Quality Gate and fail when open Sonar issues remain.

## Package contract

The package is ESM-only, uses explicit exports, emits declarations, and ships only `dist`, `README.md`, `LICENSE`, and
package metadata. The bootstrap entrypoint stays empty until the first AgentManager slice is implemented and tested.

## License

[MIT](LICENSE) © Revisium
