import { mkdir, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  beginOutputPublication,
  prepareOutputClaim,
} from '../../../../src/execution/output/claim.js';
import {
  createNodeOutputClaimPlatform,
  type NodeOutputClaimSystem,
} from '../../../../src/platform/node/output/claim.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';

const platform = createNodeOutputClaimPlatform();

const claimWith = async (
  claimPlatform: Parameters<typeof prepareOutputClaim>[0],
  workspace: string,
  outputDirectory: string,
) => {
  const prepared = await prepareOutputClaim(claimPlatform, { outputDirectory, workspace });
  return prepared.status === 'prepared' ? prepared.output.claim() : prepared;
};

const claim = (workspace: string, outputDirectory: string) =>
  claimWith(platform, workspace, outputDirectory);

test('admits an existing workspace and atomically reserves one fresh output leaf', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = join(directory, 'output');

    const result = await claim(directory, output);

    expect(result.status).toBe('claimed');
    await expect(stat(output).then((entry) => entry.isDirectory())).resolves.toBe(true);
    await expect(stat(output).then((entry) => entry.mode & 0o777)).resolves.toBe(0o700);
  });
});

test.each([
  ['a missing workspace', '/missing/workspace'],
  ['a relative workspace', 'relative-workspace'],
])('rejects %s before claiming an output leaf', async (_description, invalid) => {
  await withTemporaryDirectory(async (directory) => {
    const output = join(directory, 'output');
    const result = await claim(invalid, output);
    expect(result).toMatchObject({ status: 'rejected' });
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});

test.each([
  ['a relative output leaf', 'relative-output'],
  ['an output leaf without a parent', '/missing-parent/output'],
  ['a non-normalized absolute output leaf', '/stable/../stable/output'],
])('rejects %s before mutating the filesystem', async (_description, invalid) => {
  await withTemporaryDirectory(async (directory) => {
    await expect(claim(directory, invalid)).resolves.toMatchObject({ status: 'rejected' });
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});

test.each(['directory', 'file', 'symlink'] as const)(
  'rejects an output leaf which already exists as a %s',
  async (kind) => {
    await withTemporaryDirectory(async (directory) => {
      const output = join(directory, kind);
      if (kind === 'directory') await mkdir(output);
      if (kind === 'file') await writeFile(output, 'occupied');
      if (kind === 'symlink') await writeFile(join(directory, 'target'), 'target');
      if (kind === 'symlink') await symlink(join(directory, 'target'), output);

      await expect(claim(directory, output)).resolves.toEqual({
        reason: 'output_conflict',
        status: 'rejected',
      });
    });
  },
);

test('allows exactly one concurrent claimant for the same output leaf', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = join(directory, 'contended');

    const results = await Promise.all([claim(directory, output), claim(directory, output)]);

    expect(results.filter((result) => result.status === 'claimed')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([
      { reason: 'output_conflict', status: 'rejected' },
    ]);
  });
});

test('prepares without mkdir and permits exactly one later output claim', async () => {
  let mkdirCalls = 0;
  const prepared = await prepareOutputClaim(
    {
      createExclusiveDirectory: async () => {
        mkdirCalls += 1;
        return 'created' as const;
      },
      inspectDirectory: async () => 'directory' as const,
    },
    { outputDirectory: '/stable/output', workspace: '/stable' },
  );

  expect(prepared.status).toBe('prepared');
  expect(mkdirCalls).toBe(0);
  if (prepared.status !== 'prepared') return;
  await expect(Promise.all([prepared.output.claim(), prepared.output.claim()])).resolves.toEqual([
    expect.objectContaining({ status: 'claimed' }),
    { status: 'uncertain' },
  ]);
  expect(mkdirCalls).toBe(1);
});

test('retains a prepared claim as uncertain when its one allowed mutation rejects', async () => {
  const prepared = await prepareOutputClaim(
    {
      createExclusiveDirectory: async () => {
        throw new Error('mkdir rejection');
      },
      inspectDirectory: async () => 'directory' as const,
    },
    { outputDirectory: '/stable/output', workspace: '/stable' },
  );

  if (prepared.status !== 'prepared') throw new Error('Expected prepared output.');
  await expect(prepared.output.claim()).resolves.toEqual({ status: 'uncertain' });
  await expect(prepared.output.claim()).resolves.toEqual({ status: 'uncertain' });
});

test('does not turn arbitrary values or a finished lease into publication authority', async () => {
  await withTemporaryDirectory(async (directory) => {
    const claimed = await claim(directory, join(directory, 'output'));
    if (claimed.status !== 'claimed') throw new Error('Expected output claim.');

    expect(beginOutputPublication({ directory })).toBeUndefined();
    const lease = beginOutputPublication(claimed.output);
    if (lease === undefined) throw new Error('Expected output lease.');
    lease.finish();
    lease.finish();
    expect(beginOutputPublication(claimed.output)).toBeUndefined();
  });
});

test('fails closed when the platform cannot determine an admission or mutation outcome', async () => {
  const uncertain = createNodeOutputClaimPlatform({
    mkdir: async () => {
      const error = Object.assign(new Error('I/O uncertain'), { code: 'EIO' });
      throw error;
    },
    stat: async () => ({ isDirectory: () => true }),
  });

  await expect(claimWith(uncertain, '/stable', '/stable/output')).resolves.toEqual({
    status: 'uncertain',
  });
});

test('fails closed when either directory inspection is explicitly uncertain', async () => {
  const uncertainWorkspace = {
    createExclusiveDirectory: async () => 'created' as const,
    inspectDirectory: async () => 'uncertain' as const,
  };
  const inspections = ['directory', 'uncertain'] as const;
  let inspectionIndex = 0;
  const uncertainOutputParent = {
    createExclusiveDirectory: async () => 'created' as const,
    inspectDirectory: async () => inspections[inspectionIndex++] ?? 'uncertain',
  };

  await expect(claimWith(uncertainWorkspace, '/stable', '/stable/output')).resolves.toEqual({
    status: 'uncertain',
  });
  await expect(claimWith(uncertainOutputParent, '/stable', '/stable/output')).resolves.toEqual({
    status: 'uncertain',
  });
});

test('rejects an output path invalidated after parent inspection and handles rejected platform operations', async () => {
  const invalidated = {
    createExclusiveDirectory: async () => 'invalid_path' as const,
    inspectDirectory: async () => 'directory' as const,
  };
  const rejected = {
    createExclusiveDirectory: async () => {
      throw new Error('operation rejected');
    },
    inspectDirectory: async () => {
      throw new Error('operation rejected');
    },
  };

  await expect(claimWith(invalidated, '/stable', '/stable/output')).resolves.toEqual({
    reason: 'output_path_invalid',
    status: 'rejected',
  });
  await expect(claimWith(rejected, '/stable', '/stable/output')).resolves.toEqual({
    status: 'uncertain',
  });
});

test('maps Node directory and create errors without leaking filesystem failures', async () => {
  const error = (code: string) => Object.assign(new Error(code), { code });
  const missing: NodeOutputClaimSystem = {
    mkdir: async () => undefined,
    stat: async () => Promise.reject(error('ENOENT')),
  };
  const unknown: NodeOutputClaimSystem = {
    mkdir: async () => undefined,
    stat: async () => Promise.reject(error('EACCES')),
  };
  const existing: NodeOutputClaimSystem = {
    mkdir: async () => Promise.reject(error('EEXIST')),
    stat: async () => ({ isDirectory: () => true }),
  };
  const invalid: NodeOutputClaimSystem = {
    mkdir: async () => Promise.reject(error('ENOTDIR')),
    stat: async () => ({ isDirectory: () => true }),
  };
  const notDirectory: NodeOutputClaimSystem = {
    mkdir: async () => undefined,
    stat: async () => ({ isDirectory: () => false }),
  };
  const nodeClaimPlatform = createNodeOutputClaimPlatform(missing);

  await expect(nodeClaimPlatform.inspectDirectory('/path')).resolves.toBe('missing');
  await expect(createNodeOutputClaimPlatform(unknown).inspectDirectory('/path')).resolves.toBe(
    'uncertain',
  );
  await expect(createNodeOutputClaimPlatform(notDirectory).inspectDirectory('/path')).resolves.toBe(
    'not_directory',
  );
  await expect(
    createNodeOutputClaimPlatform(existing).createExclusiveDirectory('/path'),
  ).resolves.toBe('conflict');
  await expect(
    createNodeOutputClaimPlatform(invalid).createExclusiveDirectory('/path'),
  ).resolves.toBe('invalid_path');
});
