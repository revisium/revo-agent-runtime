# Expanded target consumer example

> [!IMPORTANT]
> This example describes the draft AgentManager v1 target. The bootstrap package still exports an empty root.

The consumer stores and supplies complete versioned definitions. Definitions are JSON data, but every selected protocol
driver, result parser, and permission strategy is package code. The normative fields and limits are defined by the
[AgentManager v1 specification](../specs/agent-manager-v1.spec.md).

## Complete Codex definition

```ts
import type { AgentDefinition } from '@revisium/revo-agent-runtime';

export const codexDefinition = {
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
} as const satisfies AgentDefinition;

export const roleResultSchema = {
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
```

## Invoke and observe

```ts
import { createAgentManager } from '@revisium/revo-agent-runtime';

import { codexDefinition, roleResultSchema } from './agents/codex.js';

const manager = createAgentManager({
  definitions: [codexDefinition],
  limits: { maxCompletedInvocations: 500 },
});

const stopAll = manager.subscribe({}, (event) => publishAgentEvent(event));
const stopOne = manager.subscribe({ invocationId: attempt.id }, (event) =>
  renderAttemptEvent(event),
);

const handle = await manager.start(
  {
    invocationId: attempt.id,
    agent: { id: 'codex', version: '1.0.0' },
    prompt: 'Implement issue #42 and return the requested JSON object.',
    workspace: { directory: workspace.path },
    parameters: { model: 'gpt-5' },
    permissions: { mode: 'workspace-write', network: false },
    metadata: { runId: run.id, stepId: step.id, attemptId: attempt.id },
    result: { schema: roleResultSchema },
    limits: { wallClockTimeoutMs: 900_000, idleTimeoutMs: 120_000 },
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

// Optional: await handle.cancel('Pipeline cancelled');

const result = await handle.result();
const lateLookup = manager.getResult(handle.invocationId);
const completed = manager.listInvocations({
  statuses: ['succeeded', 'failed', 'cancelled', 'timed_out'],
});

consumeResult(result, lateLookup, completed);
stopOne();
stopAll();
await manager.shutdown('Consumer is stopping');
```

The output directory leaf must not exist before `start()`. The manager claims it for one invocation and records bounded,
redacted `events.ndjson`, `stdout.log`, `stderr.log`, optional failure-only `raw-final-response.txt`, and `result.json`.
Live events are future-only; retained completion remains available through `getResult()` and `waitForResult()` until bounded
process-local eviction. Durable indexing, retention, and restart recovery remain consumer responsibilities.
