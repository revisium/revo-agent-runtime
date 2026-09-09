import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { test } from 'vitest';

import { nodeRecoveredProcessInspector, nodeProcessLauncher } from '../../../src/process/node.js';
import {
  assertProcessGone,
  ProcessFixture,
  processExists,
} from '../../support/fixtures/process/owned-process.js';

test('a failed OS spawn rejects without terminating its caller', { timeout: 10_000 }, async () => {
  const result = await execa(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('../../support/fixtures/process/spawn-failure.ts', import.meta.url)),
    ],
    { killDescendants: true, reject: false, timeout: 5_000 },
  );
  assert.equal(result.failed, false, result.message);
});

test('the production launcher accepts a short-lived executable', { timeout: 10_000 }, async () => {
  const child = await nodeProcessLauncher.start(
    {
      command: process.execPath,
      args: ['--version'],
      cwd: process.cwd(),
    },
    AbortSignal.timeout(5_000),
  );
  try {
    await child.transport.input.close();
    const text = await new Response(child.transport.output).text();
    assert.equal((await child.completion).exitCode, 0);
    assert.equal(text.trim(), process.version);
  } finally {
    assert.equal((await child.terminateAndReap()).status, 'confirmed');
  }
});

test(
  'owned shutdown terminates the admitted parent and its child',
  { timeout: 10_000 },
  async () => {
    const fixture = await ProcessFixture.start();
    try {
      const descendant = await fixture.spawnDescendant();
      assert.equal(processExists(descendant), true);
      await fixture.stop();
      await assertProcessGone(fixture.identity.pid);
      await assertProcessGone(descendant);
    } finally {
      await fixture.close();
    }
  },
);

test('a stale identity cannot terminate a live process', { timeout: 10_000 }, async () => {
  const fixture = await ProcessFixture.start();
  try {
    const outcome = await nodeRecoveredProcessInspector.inspectAndReconcileRecoveredProcess(
      { ...fixture.identity, fingerprint: 'sha256:a-different-process' },
      AbortSignal.timeout(5_000),
    );
    assert.equal(outcome.status, 'identity_mismatch');
    assert.equal(await fixture.ping(), 'alive');
  } finally {
    await fixture.close();
  }
});
