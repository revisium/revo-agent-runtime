import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import {
  runSessionCancellationScenario,
  runSessionContinuityScenario,
  runSessionInteractionScenario,
} from '../../smoke/session/runner.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test('session smoke answers sequential ACP permission and multi-select requests', async () => {
  const directory = await fixtureDirectory();

  await expect(
    runSessionInteractionScenario({
      definition: fakeAcpDefinition({ mode: 'session-interactions' }),
      outputDirectory: join(directory, 'output'),
      workspaceDirectory: directory,
    }),
  ).resolves.toMatchObject({
    cleanup: 'confirmed',
    interactionKinds: ['permission', 'input'],
    providerId: 'codex',
    resolvedCount: 2,
    status: 'completed',
  });
});

const fixtureDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-session-smoke-test-'));
  directories.push(directory);
  return directory;
};

test('session smoke proves hot multi-turn continuity and confirmed cleanup', async () => {
  const directory = await fixtureDirectory();

  await expect(
    runSessionContinuityScenario({
      definition: fakeAcpDefinition({ mode: 'session' }),
      nonce: 'nonce-test-73',
      outputDirectory: join(directory, 'output'),
      workspaceDirectory: directory,
    }),
  ).resolves.toMatchObject({
    cleanup: 'confirmed',
    eventCount: 11,
    nonceMatched: true,
    providerId: 'codex',
    resume: 'unsupported',
    turnStatuses: ['completed', 'completed'],
  });
});

test('session smoke cancels one bounded active turn and confirms cleanup', async () => {
  const directory = await fixtureDirectory();

  await expect(
    runSessionCancellationScenario({
      cancelDelayMs: 10,
      definition: fakeAcpDefinition({ mode: 'hang', session: true }),
      outputDirectory: join(directory, 'output'),
      workspaceDirectory: directory,
    }),
  ).resolves.toMatchObject({
    cleanup: 'confirmed',
    providerId: 'codex',
    status: 'cancelled',
  });
});
