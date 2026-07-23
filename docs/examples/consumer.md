# Expanded target consumer example

> [!IMPORTANT]
> This example describes the draft AgentManager v1 target. The root package export is still empty; implemented definition,
> registry, and executable-probe slices remain private.

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
  activeStateSink: {
    save: (snapshot, context) => activeInvocationRepository.save(snapshot, context),
    remove: (invocationId, context) => activeInvocationRepository.remove(invocationId, context),
  },
  limits: { maxCompletedInvocations: 500 },
});

const activeSnapshots = await activeInvocationRepository.listForLocalManager();
await manager.initialize(activeSnapshots);

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
process-local eviction.

`activeInvocationRepository` is consumer code. It stores only the current `running | cancelling` snapshots supplied through
the sink, honors each operation context's abort signal, and loads the rows selected for this local manager before
initialization. For a live invocation, the runtime removes its row only after the owned POSIX process group is confirmed gone.
During initialization it may instead remove a row whose recorded leader is definitely absent, without claiming descendant
cleanup. Results and completed history stay in the existing result/output and consumer workflow layers. The consumer also
owns row integrity/provenance, DBOS, retries, distributed locks/races, durable indexing, retention, and recovery policy. The
exact local process identity and cleanup rules are defined by
[ADR-0006](../adr/0006-consumer-backed-active-invocation-recovery.md).
