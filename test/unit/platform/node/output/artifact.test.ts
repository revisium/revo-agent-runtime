import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  createNodeOutputArtifactPlatform,
  nodeOutputArtifactPlatform,
} from '../../../../../src/platform/node/output/artifact.js';
import { withTemporaryDirectory } from '../../../../support/assertions/temporary-directory.js';

const bytes = new TextEncoder().encode('Read .revo/index.md.\n');

test('creates the file exclusively with owner-only permissions and removes it on request', async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, 'revo-opencode-instructions.md');

    await expect(nodeOutputArtifactPlatform.createPrivateFile(path, bytes)).resolves.toBe(
      'created',
    );
    expect(await readFile(path, 'utf8')).toBe('Read .revo/index.md.\n');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(nodeOutputArtifactPlatform.createPrivateFile(path, bytes)).resolves.toBe(
      'conflict',
    );

    await nodeOutputArtifactPlatform.removeFile(path);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeOutputArtifactPlatform.removeFile(path)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

test('a missing parent or a failed write reports failure and leaves no partial file', async () => {
  await withTemporaryDirectory(async (directory) => {
    await expect(
      nodeOutputArtifactPlatform.createPrivateFile(join(directory, 'missing', 'file.md'), bytes),
    ).resolves.toBe('failed');

    const removed: string[] = [];
    const platform = createNodeOutputArtifactPlatform({
      open: async () => ({
        close: async () => {
          throw new Error('close failed');
        },
        writeFile: async () => {
          throw new Error('disk full');
        },
      }),
      unlink: async (path) => {
        removed.push(path);
      },
    });

    await expect(platform.createPrivateFile('/output/file.md', bytes)).resolves.toBe('failed');
    expect(removed).toEqual(['/output/file.md']);
  });
});

test('a failed write still reports failure when cleanup unlink also fails', async () => {
  const platform = createNodeOutputArtifactPlatform({
    open: async () => ({
      close: async () => undefined,
      writeFile: async () => {
        throw new Error('disk full');
      },
    }),
    unlink: async () => {
      throw new Error('unlink failed');
    },
  });

  await expect(platform.createPrivateFile('/output/file.md', bytes)).resolves.toBe('failed');
});
