<div align="center">

# @revisium/revo-agent-runtime

**A portable, attempt-scoped execution runtime for AI agents.**

[![CI](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> The repository is in its bootstrap phase. The npm package has not been published and no runtime API is available yet.

## About

`@revisium/revo-agent-runtime` will provide one framework-independent boundary for invoking AI agents through native command-line protocols and Agent Client Protocol (ACP). The runtime will normalize process lifecycle, protocol handling, bounded events, usage, artifacts, and terminal outcomes without taking ownership of orchestration or durable product state.

This initial revision intentionally contains only the package toolchain, quality gates, and target architecture documentation. The runtime API shown below is a design target and is not exported yet.

## Boundary

The package will own:

- an attempt-scoped invocation contract and normalized outcome;
- runner manifest validation and sealed protocol/parser/permission strategies;
- Codex, Claude, and ACP adapters;
- process spawning, standard streams, deadlines, cancellation, and reaping;
- bounded, redacted execution events and opaque artifact references;
- contract fixtures for consumers and adapter implementations.

The consuming orchestrator keeps ownership of runner selection, immutable execution-plan pins, prompts, workspaces, durable retries, pipelines, gates, persistence, and public API projections. Git, GitHub, and other deterministic system operations belong to `@revisium/revo-scripts`; the two packages do not depend on each other.

See [the architecture overview](./docs/architecture.md), [ADR-0001](./docs/adr/0001-agent-runtime-boundary.md), and [the repository contract](./REPOSITORY.md) for the complete ownership rules.

## Target consumer usage

The intended consumer shape is one fully resolved invocation in and one normalized outcome out. Names in this example remain provisional until the first public contract is implemented.

```ts
import { createAgentRuntime } from '@revisium/revo-agent-runtime';

const runtime = createAgentRuntime({
  strategies,
  eventSink,
  artifactSink,
  redact,
});

const outcome = await runtime.invoke(
  {
    schemaVersion: 'agent-invocation/v1',
    identity: { runId, stepKey, attemptId, attemptNo },
    runner: executionPlan.agent.runner,
    model: executionPlan.agent.model,
    permissions: executionPlan.agent.permissions,
    prompt,
    resultSchema,
    limits: {
      idleTimeoutMs: 120_000,
      wallClockTimeoutMs: 900_000,
      maxEventBytes: 64_000,
      maxTerminalBytes: 1_000_000,
    },
  },
  {
    cwd: workspace.path,
    signal,
  },
);

await attempts.record(attemptId, outcome);
```

The consumer supplies a complete immutable runner pin. The runtime validates and executes it without reading a mutable runner catalog or deciding which runner, model, workspace, or retry policy to use.

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

Useful commands:

| Command               | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `pnpm build`          | Build ESM JavaScript and TypeScript declarations with TypeScript 7 |
| `pnpm format`         | Format supported repository files with Oxfmt                       |
| `pnpm format:check`   | Verify formatting without writing files                            |
| `pnpm lint`           | Run type-aware Oxlint and TypeScript diagnostics                   |
| `pnpm test`           | Run the Node.js test suite                                         |
| `pnpm test:cov`       | Run tests and write LCOV coverage                                  |
| `pnpm verify`         | Run the complete local CI gate                                     |
| `pnpm ci:local:sonar` | Run verification, Sonar analysis, and open-issue inspection        |

## SonarCloud

Copy `.env.sonar.example` to an ignored local file and provide a Sonar token:

```bash
cp .env.sonar.example .env.sonar
pnpm ci:local:sonar
```

An existing environment file can be reused without copying secrets:

```bash
SONAR_ENV_FILE=/absolute/path/to/.env.sonar pnpm ci:local:sonar
```

CI runs the same verification gate before Sonar analysis. Pull requests additionally wait for the Quality Gate and fail when open Sonar issues remain.

## Package contract

The package is ESM-only, uses explicit exports, emits declarations, and ships only `dist`, `README.md`, `LICENSE`, and package metadata. Package contents and type declarations are validated during `pnpm verify`. The bootstrap entry point is deliberately empty until the first invocation contract is accepted and tested.

## License

[MIT](LICENSE) © Revisium
