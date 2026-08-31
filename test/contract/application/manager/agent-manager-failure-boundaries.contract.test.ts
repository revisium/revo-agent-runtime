import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager, type AgentManager } from '../../../../src/index.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import {
  publicAgentManager as managerWith,
  publicInvocationRequest as requestFor,
} from '../../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

const startUnchecked = (manager: AgentManager, request: unknown): unknown =>
  Reflect.apply(
    (checkedRequest: Parameters<AgentManager['start']>[0]) => manager.start(checkedRequest),
    undefined,
    [request],
  );
test('rejects an output leaf whose parent does not exist before accepting', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    await manager.initialize([]);

    await expect(
      manager.start({
        ...requestFor(directory, 'output-failure'),
        output: {
          directory: join(directory, 'missing-output-parent', 'output-output-failure'),
        },
      }),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.output_path_invalid', phase: 'preflight' },
    });

    await manager.shutdown();
  });
});

test.each([
  ['empty-result', 'revo.agent.result_missing'],
  ['duplicate-result', 'revo.agent.protocol_failed'],
])('maps %s to its exact typed result fault', async (mode, code) => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith(mode);
    await manager.initialize([]);

    const result = await (await manager.start(requestFor(directory, `typed-${mode}`))).result();

    await manager.shutdown();
    expect(result).toMatchObject({ error: { code }, status: 'failed' });
  });
});

test('rejects a schema-invalid object and publishes only bounded raw evidence', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    await manager.initialize([]);

    const result = await (
      await manager.start({
        ...requestFor(directory, 'schema-mismatch'),
        result: {
          schema: {
            additionalProperties: false,
            properties: { answer: { const: 'different answer' } },
            required: ['answer'],
            type: 'object',
          },
        },
      })
    ).result();

    await manager.shutdown();
    expect(result).toMatchObject({
      error: { code: 'revo.agent.result_schema_mismatch' },
      rawResponse: { file: 'raw-final-response.txt', truncated: false },
      status: 'failed',
    });
    expect(
      (await stat(join(result.files.directory, 'raw-final-response.txt'))).size,
    ).toBeLessThanOrEqual(1_048_576);
  });
});

test('contains hostile starts and environment requests at the public preflight boundary', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    await manager.initialize([]);
    const hostile = new Proxy(requestFor(directory, 'hostile-start'), {
      ownKeys: () => {
        throw new Error('do not expose this provider payload');
      },
    });

    await expect(startUnchecked(manager, hostile)).rejects.toMatchObject({
      fault: { code: 'revo.agent.definition_invalid', phase: 'preflight' },
    });
    await expect(
      manager.start(requestFor(directory, 'credential-inherit'), {
        environment: { inherit: ['API_KEY'], secrets: {}, variables: {} },
      }),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.definition_invalid', phase: 'preflight' },
    });
    await manager.shutdown();
  });
});

test('rejects bounded and non-plain invocation inputs before public acceptance', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith();
    const events: string[] = [];
    await manager.initialize([]);
    manager.subscribe({}, ({ type }) => events.push(type));
    const invalid = [
      { ...requestFor(directory, 'x'.repeat(257)) },
      { ...requestFor(directory, 'non-plain-parameters'), parameters: { createdAt: new Date() } },
      {
        ...requestFor(directory, 'unexpected-workspace-key'),
        workspace: { directory: process.cwd(), unexpected: true },
      },
    ];

    await Promise.all(
      invalid.map((request) =>
        expect(startUnchecked(manager, request)).rejects.toMatchObject({
          fault: { code: 'revo.agent.definition_invalid', phase: 'preflight' },
        }),
      ),
    );

    await manager.shutdown();
    expect(events).toEqual([]);
  });
});

test('keeps the longest valid invocation event inside the minimum event budget', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition()],
      limits: { maxEventBytes: 1_024 },
    });
    await manager.initialize([]);

    const result = await (await manager.start(requestFor(directory, 'x'.repeat(256)))).result();

    await manager.shutdown();
    expect(result).toMatchObject({ status: 'succeeded' });
    const events = await readFile(join(result.files.directory, 'events.ndjson'));
    for (const line of events.toString('utf8').trimEnd().split('\n'))
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(1_024);
  });
});

test('enforces the v1 output and redaction construction limits', () => {
  const options = {
    activeStateSink: noOpActiveStateSink,
    definitions: [agentDefinition()],
  };
  expect(() => createAgentManager({ ...options, limits: { maxStdoutBytes: 65_535 } })).toThrow(
    'Agent manager limit is invalid.',
  );
  expect(() =>
    createAgentManager({
      ...options,
      limits: { maxEventBytes: 65_536, maxEventsFileBytes: 2_162_689 },
    }),
  ).toThrow('Agent manager limit is invalid.');
  expect(() => createAgentManager({ ...options, redaction: { secrets: [''] } })).toThrow(
    'Agent definition is invalid.',
  );
});
