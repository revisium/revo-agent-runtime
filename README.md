<div align="center">

# @revisium/revo-agent-runtime

**A portable runtime and process-local manager for exact, versioned AI-agent invocations.**

[![CI](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-agent-runtime/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-agent-runtime&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-agent-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> The repository is in bootstrap. The npm package has not been published and its root export is intentionally empty. The
> AgentManager API below is a target specification, not available code.

## About

`@revisium/revo-agent-runtime` will provide one framework-independent `AgentManager` for invoking native command-line and
ACP agents. The consumer supplies all immutable versioned definitions at construction, chooses one exact agent version for
each invocation, and provides one exact output directory. The package will normalize discovery, process lifecycle, bounded
redacted events and files, cancellation, usage, typed failures, and validated JSON results.

The consumer retains orchestration, runs/steps/attempts, durable retry and workflow state, definition storage, path
construction, file retention, restart recovery, and product verdicts. Git, GitHub, and other deterministic system operations
belong to `@revisium/revo-scripts`; the packages do not depend on each other.

See the [AgentManager v1 draft specification](./docs/specs/agent-manager-v1.spec.md),
[architecture](./docs/architecture.md), [decisions](./docs/README.md), and
[repository contract](./REPOSITORY.md).

## Target consumer usage

The complete example below is deliberately marked target-only. It illustrates the intended public API; these names are not
exported yet.

### Define an agent

Definitions are versioned data. The manager validates and seals the complete set at construction. Adding a new agent that
uses existing package strategies requires data, not a consumer executor branch.

```ts
const codexDefinition = {
  schemaVersion: 'agent-definition/v1',
  id: 'codex',
  version: '1.0.0',
  displayName: 'Codex CLI',
  description: 'Runs one Codex invocation through the native JSONL protocol.',
  launch: {
    command: 'codex',
    args: [
      { kind: 'literal', value: 'exec' },
      { kind: 'literal', value: '--json' },
      { kind: 'literal', value: '--output-schema' },
      { kind: 'result-schema-file' },
      { kind: 'literal', value: '--sandbox' },
      { kind: 'permission', name: 'mode' },
      { kind: 'permission', name: 'network' },
      { kind: 'literal', value: '--model' },
      { kind: 'parameter', name: 'model' },
      { kind: 'prompt' },
    ],
    versionProbe: {
      args: ['--version'],
      stream: 'stdout',
      prefix: 'codex-cli ',
      timeoutMs: 5_000,
    },
  },
  protocol: {
    driver: 'native/stdio-v1',
    resultParser: 'codex-jsonl/v1',
    permissionStrategy: 'codex-cli/v1',
  },
  delivery: {
    prompt: 'argument',
    resultSchema: 'file',
    result: 'stdout',
  },
  parameters: {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        model: { type: 'string', minLength: 1, maxLength: 128 },
      },
      required: ['model'],
      additionalProperties: false,
    },
  },
  permissions: {
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        mode: { enum: ['read-only', 'workspace-write'] },
        network: { type: 'boolean' },
      },
      required: ['mode', 'network'],
      additionalProperties: false,
    },
    defaults: { mode: 'read-only', network: false },
  },
  capabilities: {
    cancellation: true,
    structuredResult: true,
    usage: true,
  },
  constraints: {
    platforms: ['darwin', 'linux'],
    executableVersion: '>=1.0.0',
  },
} as const;
```

### Create, discover, and observe

```ts
import { createAgentManager } from '@revisium/revo-agent-runtime';

const manager = createAgentManager({
  definitions: [codexDefinition, claudeDefinition, acpDefinition],
  limits: {
    maxCompletedInvocations: 500,
  },
  redaction: {
    secrets: runtimeSecrets,
  },
});

const agents = manager.listAgents();
const codex = manager.getAgent({ id: 'codex', version: '1.0.0' });
const availability = await manager.probeAgent({ id: 'codex', version: '1.0.0' });

const stopAll = manager.subscribe({}, (event) => {
  publishAgentEvent(event);
});
```

The registry is immutable. V1 has no `register`, `replace`, latest-version, or fallback API. Construct a new manager to use a
new definition set.

### Start one exact invocation

The consumer chooses the opaque `invocationId` and exact directory. Revo may use an attempt id and its own nested path; the
manager does not interpret either value.

```ts
const roleResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    verdict: { enum: ['completed', 'blocked', 'needs_human'] },
    output: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'object' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'output', 'artifacts', 'nextSteps'],
  additionalProperties: false,
} as const;

const invocationId = attempt.id;

const stopOne = manager.subscribe({ invocationId }, (event) => {
  renderAttemptEvent(event);
});

const handle = await manager.start(
  {
    invocationId,
    agent: { id: 'codex', version: '1.0.0' },
    prompt: 'Implement issue #42 and return the requested JSON object.',
    workspace: { directory: workspace.path },
    parameters: { model: 'gpt-5' },
    permissions: { mode: 'workspace-write', network: false },
    metadata: {
      runId: run.id,
      stepId: step.id,
      attemptId: attempt.id,
    },
    result: { schema: roleResultSchema },
    limits: {
      wallClockTimeoutMs: 900_000,
      idleTimeoutMs: 120_000,
    },
    output: {
      directory: attempt.agentOutputDirectory,
    },
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
```

The child receives no wholesale `process.env`. Only named inherited values and explicit variables are copied; both are
non-secret and may appear if the child emits them. Credential-like keys must use `secrets`, whose values are invocation-local
and automatically registered with streaming redaction before spawn.

The output leaf must not exist. The manager creates missing parents, atomically creates that leaf for this invocation, and
reserves:

```text
.scratch/               # ephemeral; normally removed after process reap
events.ndjson
stdout.log
stderr.log
raw-final-response.txt  # only when final response handling fails
result.json             # atomically published when terminal commit succeeds
```

Any existing leaf is `output_conflict`; the manager never adopts, overwrites, or suffixes it. `result.json` is published
exclusively and never replaces an existing path.

### Obtain the result

```ts
const result = await handle.result();

if (result.status === 'succeeded') {
  consumeRoleResult(result.value);
} else {
  reportAgentFault(result.error);
}
```

Success is only a top-level JSON object validated against the supplied draft 2020-12 schema. Missing, malformed, primitive,
array, oversized, or schema-invalid output returns a typed failed result with a bounded redacted raw-response diagnostic.
There is no text-success contract.

The terminal result is not event-only. It remains available while retained by this manager:

```ts
const lookup = manager.getResult(invocationId);

if (lookup.state === 'completed') {
  consumeCompletedResult(lookup.result);
}

const sameResult = await manager.waitForResult(invocationId);

const terminalInvocations = manager.listInvocations({
  statuses: ['succeeded', 'failed', 'cancelled', 'timed_out'],
});

stopOne();
stopAll();
```

Each accepted invocation delivers exactly one process-local `invocation.finished`. Before delivery, the process-local
completed record exists, so a handler can call `getResult(invocationId)` without a race. A late filesystem failure still
completes in memory with a typed error; `result.json` or the terminal NDJSON line may then be absent and the audit record is
incomplete. Completed retention is bounded FIFO; eviction makes an id unknown but never deletes consumer files.

### Cancel an active invocation

Cancellation is a separate flow; it is not required before awaiting an ordinary result.

```ts
const cancellable = await manager.start(cancellationRequest);

const cancellation = await manager.cancel(cancellable.invocationId, 'Pipeline was cancelled');
// Equivalent: await cancellable.cancel('Pipeline was cancelled');

const cancelledResult = await cancellable.result();
```

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

| Command                    | Purpose                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `pnpm build`               | Build ESM JavaScript and TypeScript declarations with TypeScript 7      |
| `pnpm format`              | Format supported repository files with Oxfmt                            |
| `pnpm format:check`        | Verify formatting without writing files                                 |
| `pnpm lint`                | Run type-aware Oxlint and TypeScript diagnostics                        |
| `pnpm test`                | Run all currently owned Vitest lanes                                    |
| `pnpm test:package`        | Prove bootstrap entrypoint and package metadata                         |
| `pnpm test:architecture`   | Prove positive boundaries plus layer, consumer, and cycle probes        |
| `pnpm test:cov`            | Run Vitest with v8 coverage and write `coverage/lcov.info`              |
| `pnpm verify:package`      | Validate build metadata, tarball contents, types, ESM, and deep imports |
| `pnpm verify:architecture` | Run the committed architecture verification harness                     |
| `pnpm verify`              | Run the complete local CI gate                                          |
| `pnpm ci:local:sonar`      | Run verification, Sonar analysis, and open-issue inspection             |

Unit, contract, and integration lanes will be added only when their owned production behavior exists. Bootstrap does not
use empty test scripts or permanent `passWithNoTests`.

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

CI runs the same verification gate before Sonar analysis. Pull requests additionally wait for the Quality Gate and fail
when open Sonar issues remain.

## Package contract

The package is ESM-only, uses explicit exports, emits declarations, and ships only `dist`, `README.md`, `LICENSE`, and
package metadata. The exact packed tarball is checked through isolated runtime and strict TypeScript consumers. The bootstrap
entrypoint remains deliberately empty until the first AgentManager slice is implemented and tested.

## License

[MIT](LICENSE) © Revisium
