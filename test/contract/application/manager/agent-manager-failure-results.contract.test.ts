import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager } from '../../../../src/index.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import {
  publicAgentManager as managerWith,
  publicInvocationRequest as requestFor,
  readPublicOutput,
} from '../../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

test.each(['array-result', 'eof', 'exit-without-terminal', 'malformed', 'primitive-result'])(
  'resolves expected ACP %s as a typed failed terminal result',
  async (mode) => {
    await withTemporaryDirectory(async (directory) => {
      const manager = managerWith(mode);
      await manager.initialize([]);

      const result = await (await manager.start(requestFor(directory, `failed-${mode}`))).result();

      await manager.shutdown();

      expect(result).toMatchObject({
        error: {
          code:
            mode === 'array-result' || mode === 'primitive-result'
              ? 'revo.agent.result_not_object'
              : 'revo.agent.protocol_failed',
          phase:
            mode === 'array-result' || mode === 'primitive-result'
              ? 'collecting_result'
              : 'execution',
          retryable: false,
        },
        status: 'failed',
      });
    });
  },
);

test('ignores ACP updates that are not final agent text', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = managerWith('non-text-updates');
    await manager.initialize([]);

    const result = await (await manager.start(requestFor(directory, 'non-text-updates'))).result();

    await manager.shutdown();
    expect(result).toMatchObject({ status: 'succeeded', value: { answer: 'fake ACP result' } });
  });
});

test('fails a non-literal ACP bridge command without dropping launch input', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ withWorkspaceArg: true })],
    });
    await manager.initialize([]);

    const start = manager.start(requestFor(directory, 'non-literal-launch'));

    await expect(start).rejects.toMatchObject({
      fault: { code: 'revo.agent.protocol_failed' },
    });
    await manager.shutdown();
  });
});

test('normalizes a bridge spawn failure into a typed terminal result', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ command: join(directory, 'missing-acp-bridge') })],
    });
    await manager.initialize([]);

    const start = manager.start(requestFor(directory, 'missing-acp-bridge'));

    await expect(start).rejects.toMatchObject({
      fault: { code: 'revo.agent.probe_spawn_failed', phase: 'preflight' },
    });
    await manager.shutdown();
  });
});

test('redacts configured and invocation secrets before results and output files become public', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'literal-secret-result' })],
      redaction: { secrets: ['literal-secret'] },
    });
    await manager.initialize([]);

    const result = await (await manager.start(requestFor(directory, 'redacted-result'))).result();

    await manager.shutdown();
    expect(result).toMatchObject({
      files: {
        events: 'events.ndjson',
        result: 'result.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      status: 'succeeded',
      value: { answer: '[REDACTED]' },
    });
    const publicBytes = await readPublicOutput(result.files.directory, [
      'events.ndjson',
      'result.json',
      'stderr.log',
      'stdout.log',
    ]);
    expect(publicBytes.join('\n')).not.toContain('literal-secret');
    expect(publicBytes.join('\n')).toContain('[REDACTED]');
  });
});

test('bounds oversized protocol evidence and stdout with an in-budget marker', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [fakeAcpDefinition({ mode: 'oversized-result' })],
      limits: { maxRawResponseBytes: 65_536, maxStdoutBytes: 65_536 },
    });
    await manager.initialize([]);

    const result = await (await manager.start(requestFor(directory, 'bounded-result'))).result();

    await manager.shutdown();
    expect(result).toMatchObject({
      error: { code: 'revo.agent.result_too_large' },
      rawResponse: {
        file: 'raw-final-response.txt',
        retainedByteLength: 65_536,
        truncated: true,
      },
      status: 'failed',
    });
    expect((await stat(join(result.files.directory, 'raw-final-response.txt'))).size).toBe(65_536);
    const stdout = await readFile(join(result.files.directory, 'stdout.log'));
    expect(stdout.byteLength).toBe(65_536);
    expect(stdout.toString('utf8')).toMatch(/\n\[output truncated\]\n$/);
  });
});

test('passes only the explicit environment allowlist and redacts secret values', async () => {
  await withTemporaryDirectory(async (directory) => {
    const previousHostSecret = process.env.UNRELATED_HOST_SECRET;
    process.env.UNRELATED_HOST_SECRET = 'must-not-reach-child';
    try {
      const manager = createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: [fakeAcpDefinition({ mode: 'environment-result' })],
      });
      await manager.initialize([]);

      const result = await (
        await manager.start(requestFor(directory, 'explicit-environment'), {
          environment: {
            inherit: [],
            secrets: { SECRET_CHILD: 'child-secret' },
            variables: { VISIBLE_VALUE: 'visible' },
          },
        })
      ).result();

      await manager.shutdown();
      expect(result).toMatchObject({
        status: 'succeeded',
        value: { answer: 'visible', secret: '[REDACTED]', unrelated: null },
      });
      expect(await readFile(join(result.files.directory, 'result.json'), 'utf8')).not.toContain(
        'child-secret',
      );
      expect(await readFile(join(result.files.directory, 'stdout.log'), 'utf8')).not.toContain(
        'child-secret',
      );
    } finally {
      if (previousHostSecret === undefined) delete process.env.UNRELATED_HOST_SECRET;
      else process.env.UNRELATED_HOST_SECRET = previousHostSecret;
    }
  });
});
