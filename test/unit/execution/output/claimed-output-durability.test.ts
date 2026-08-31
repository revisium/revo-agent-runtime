import { basename, join } from 'node:path';

import { expect, test } from 'vitest';

import {
  createNodeClaimedOutputPublisher,
  type NodeOutputPublicationSystem,
} from '../../../../src/platform/node/output/publication.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import {
  claimOutput as claim,
  outputPublication as publication,
} from '../../../support/fixtures/claimed-output.js';
test('flushes each committed directory entry before removing its temporary name and commits result last', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const operations: string[] = [];
    let currentFile = '';
    const durableSystem: NodeOutputPublicationSystem = {
      link: async (_temporaryPath, finalPath) => {
        currentFile = basename(finalPath);
        operations.push(`link:${currentFile}`);
      },
      open: async (path, _flags, mode) => {
        expect(mode).toBe(0o600);
        currentFile = basename(path)
          .replace(/^\./, '')
          .replace(/\.revo-tmp$/, '');
        return {
          close: async () => {
            operations.push(`close-file:${currentFile}`);
          },
          sync: async () => {
            operations.push(`sync-file:${currentFile}`);
          },
          writeFile: async () => {
            operations.push(`write:${currentFile}`);
          },
        };
      },
      openDirectory: async () => ({
        close: async () => {
          operations.push(`close-directory:${currentFile}`);
        },
        sync: async () => {
          operations.push(`sync-directory:${currentFile}`);
        },
      }),
      unlink: async () => {
        operations.push(`unlink:${currentFile}`);
      },
    };

    await expect(
      createNodeClaimedOutputPublisher(durableSystem).publish(
        output,
        publication(join(directory, 'output')),
      ),
    ).resolves.toMatchObject({ status: 'published' });

    expect(operations.filter((operation) => operation.startsWith('link:'))).toEqual([
      'link:events.ndjson',
      'link:stdout.log',
      'link:stderr.log',
      'link:result.json',
    ]);
    for (const filename of ['events.ndjson', 'stdout.log', 'stderr.log', 'result.json']) {
      expect(operations.indexOf(`write:${filename}`)).toBeLessThan(
        operations.indexOf(`sync-file:${filename}`),
      );
      expect(operations.indexOf(`sync-file:${filename}`)).toBeLessThan(
        operations.indexOf(`close-file:${filename}`),
      );
      expect(operations.indexOf(`close-file:${filename}`)).toBeLessThan(
        operations.indexOf(`link:${filename}`),
      );
      expect(operations.indexOf(`link:${filename}`)).toBeLessThan(
        operations.indexOf(`sync-directory:${filename}`),
      );
      expect(operations.indexOf(`sync-directory:${filename}`)).toBeLessThan(
        operations.indexOf(`close-directory:${filename}`),
      );
      expect(operations.indexOf(`close-directory:${filename}`)).toBeLessThan(
        operations.indexOf(`unlink:${filename}`),
      );
    }
  });
});

test('reports a committed file as uncertain when its directory entry cannot be flushed', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    let cleanupAttempted = false;
    const directoryFlushFailure: NodeOutputPublicationSystem = {
      link: async () => undefined,
      open: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
        writeFile: async () => undefined,
      }),
      openDirectory: async () => ({
        close: async () => undefined,
        sync: async () => {
          throw new Error('directory flush failed');
        },
      }),
      unlink: async () => {
        cleanupAttempted = true;
      },
    };

    await expect(
      createNodeClaimedOutputPublisher(directoryFlushFailure).publish(
        output,
        publication(outputDirectory),
      ),
    ).resolves.toEqual({ files: ['events.ndjson'], status: 'uncertain' });
    expect(cleanupAttempted).toBe(false);
  });
});

test('records result.json when its final directory commit becomes uncertain', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    let directoryFlushes = 0;
    const uncertainResultCommit: NodeOutputPublicationSystem = {
      link: async () => undefined,
      open: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
        writeFile: async () => undefined,
      }),
      openDirectory: async () => ({
        close: async () => undefined,
        sync: async () => {
          directoryFlushes += 1;
          if (directoryFlushes === 4) throw new Error('result directory flush failed');
        },
      }),
      unlink: async () => undefined,
    };

    await expect(
      createNodeClaimedOutputPublisher(uncertainResultCommit).publish(
        output,
        publication(join(directory, 'output')),
      ),
    ).resolves.toEqual({
      files: ['events.ndjson', 'stdout.log', 'stderr.log', 'result.json'],
      status: 'uncertain',
    });
  });
});

test('does not downgrade durably published files when temporary cleanup fails', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    const cleanupUnconfirmed: NodeOutputPublicationSystem = {
      link: async () => undefined,
      open: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
        writeFile: async () => undefined,
      }),
      openDirectory: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
      }),
      unlink: async () => {
        throw new Error('temporary cleanup failed');
      },
    };

    await expect(
      createNodeClaimedOutputPublisher(cleanupUnconfirmed).publish(
        output,
        publication(outputDirectory),
      ),
    ).resolves.toEqual({
      files: ['events.ndjson', 'stdout.log', 'stderr.log', 'result.json'],
      status: 'published',
    });
  });
});
