import { expect, test, vi } from 'vitest';

import {
  promptPrefixDelivery,
  type InstructionsDeliveryPlan,
} from '../../../../src/execution/instructions/delivery.js';
import {
  prepareInstructionsDelivery,
  protocolInstructions,
} from '../../../../src/execution/instructions/prepare.js';
import type { OutputArtifactPlatform } from '../../../../src/execution/output/artifact.js';

const request = {
  definitionId: 'opencode-acp',
  definitionVersion: '1.0.0',
  environmentNames: [],
  instructions: 'Read .revo/index.md.',
  outputDirectory: '/output',
  reportedVersion: '1.18.23',
};
const filePlan: InstructionsDeliveryPlan = {
  artifact: { bytes: new TextEncoder().encode('Read .revo/index.md.'), path: '/output/file.md' },
  channel: 'opencode:config.instructions-file',
  environment: { OPENCODE_CONFIG_CONTENT: '{"instructions":["/output/file.md"]}' },
  mode: 'native_append',
};
const metaPlan: InstructionsDeliveryPlan = {
  channel: 'acp:session/new._meta.systemPrompt.append',
  mode: 'native_append',
  sessionMeta: { systemPrompt: { append: 'Read .revo/index.md.' } },
};

const artifacts = (
  creation: 'created' | 'conflict' | 'failed' | 'throw' = 'created',
  removal: 'ok' | 'throw' = 'ok',
) => {
  const removed: string[] = [];
  const platform: OutputArtifactPlatform = {
    createPrivateFile: async () => {
      if (creation === 'throw') throw new Error('filesystem unavailable');
      return creation;
    },
    removeFile: async (path) => {
      removed.push(path);
      if (removal === 'throw') throw new Error('unlink failed');
    },
  };
  return { platform, removed };
};

test('a prefix plan carries only the text and decision', async () => {
  const story = artifacts();
  const prepared = await prepareInstructionsDelivery({
    artifacts: story.platform,
    request,
    resolve: () => promptPrefixDelivery,
  });

  expect(prepared).toEqual({
    status: 'prepared',
    value: { delivery: promptPrefixDelivery, text: 'Read .revo/index.md.' },
  });
});

test('a session metadata plan keeps its wire metadata for the driver', async () => {
  const prepared = await prepareInstructionsDelivery({
    artifacts: artifacts().platform,
    request,
    resolve: () => metaPlan,
  });
  if (prepared.status !== 'prepared') throw new Error('Expected preparation.');

  expect(protocolInstructions(prepared.value)).toEqual({
    delivery: { channel: metaPlan.channel, mode: 'native_append' },
    sessionMeta: { systemPrompt: { append: 'Read .revo/index.md.' } },
    text: 'Read .revo/index.md.',
  });
});

test('a file plan creates the artifact, exposes its environment, and disposes it once', async () => {
  const story = artifacts();
  const prepared = await prepareInstructionsDelivery({
    artifacts: story.platform,
    request,
    resolve: () => filePlan,
  });
  if (prepared.status !== 'prepared') throw new Error('Expected preparation.');

  expect(prepared.value).toMatchObject({
    delivery: { channel: 'opencode:config.instructions-file', mode: 'native_append' },
    environment: filePlan.environment,
  });
  expect(prepared.value.artifact?.path).toBe('/output/file.md');
  expect(protocolInstructions(prepared.value)).not.toHaveProperty('artifact');
  await prepared.value.artifact?.dispose();
  await prepared.value.artifact?.dispose();
  expect(story.removed).toEqual(['/output/file.md']);
});

test('a resume adjustment can downgrade the fresh plan before any file is written', async () => {
  const story = artifacts();
  const adjust = vi.fn(() => promptPrefixDelivery);
  const prepared = await prepareInstructionsDelivery({
    adjust,
    artifacts: story.platform,
    request,
    resolve: () => filePlan,
  });

  expect(adjust).toHaveBeenCalledWith(filePlan);
  expect(prepared).toMatchObject({ status: 'prepared', value: { delivery: promptPrefixDelivery } });
});

test.each(['conflict', 'failed', 'throw'] as const)(
  'a file that cannot be created (%s) fails the preparation instead of falling back',
  async (creation) => {
    await expect(
      prepareInstructionsDelivery({
        artifacts: artifacts(creation).platform,
        request,
        resolve: () => filePlan,
      }),
    ).resolves.toEqual({ status: 'write_failed' });
  },
);

test('a failed removal is swallowed because the directory stays private', async () => {
  const story = artifacts('created', 'throw');
  const prepared = await prepareInstructionsDelivery({
    artifacts: story.platform,
    request,
    resolve: () => filePlan,
  });
  if (prepared.status !== 'prepared') throw new Error('Expected preparation.');

  await expect(prepared.value.artifact?.dispose()).resolves.toBeUndefined();
});
