import { link, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { expect, test } from 'vitest';

import {
  createNodeClaimedOutputPublisher,
  type NodeOutputPublicationSystem,
} from '../../../../src/platform/node/output/publication.js';
import { withTemporaryDirectory } from '../../../support/assertions/temporary-directory.js';
import {
  claimOutput as claim,
  claimOutputAt as claimAt,
  failedResultWithoutFile,
  outputPublication as publication,
  successfulOutputResult as result,
} from '../../../support/fixtures/claimed-output.js';
test('publishes bounded owner-only evidence before an atomically committed result and reports exact files', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    const published = await createNodeClaimedOutputPublisher().publish(
      output,
      publication(outputDirectory, new TextEncoder().encode('raw')),
    );

    expect(published).toEqual({
      files: ['events.ndjson', 'stdout.log', 'stderr.log', 'raw-final-response.txt', 'result.json'],
      status: 'published',
    });
    const files = (await readdir(outputDirectory)).sort();
    expect(files).toEqual([
      'events.ndjson',
      'raw-final-response.txt',
      'result.json',
      'stderr.log',
      'stdout.log',
    ]);
    await expect(readFile(join(outputDirectory, 'result.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(result(outputDirectory, true))}\n`,
    );
    await expect(
      Promise.all(
        files.map(async (filename) =>
          stat(join(outputDirectory, filename)).then((entry) => entry.mode & 0o777),
        ),
      ),
    ).resolves.toEqual([0o600, 0o600, 0o600, 0o600, 0o600]);
  });
});

test('does not overwrite a result introduced after claim and consumes the capability after one publication', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    await writeFile(join(outputDirectory, 'result.json'), 'consumer-evidence');
    const publisher = createNodeClaimedOutputPublisher();

    await expect(publisher.publish(output, publication(outputDirectory))).resolves.toEqual({
      files: ['events.ndjson', 'stdout.log', 'stderr.log'],
      status: 'failed',
    });
    await expect(readFile(join(outputDirectory, 'result.json'), 'utf8')).resolves.toBe(
      'consumer-evidence',
    );
    await expect(publisher.publish(output, publication(outputDirectory))).resolves.toEqual({
      files: [],
      status: 'failed',
    });
    await expect(readdir(outputDirectory)).resolves.not.toContain('.result.json.revo-tmp');
  });
});

test('does not adopt or remove a temporary evidence name it did not create', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    const temporaryPath = join(outputDirectory, '.events.ndjson.revo-tmp');
    await writeFile(temporaryPath, 'consumer-temporary');

    await expect(
      createNodeClaimedOutputPublisher().publish(output, publication(outputDirectory)),
    ).resolves.toEqual({ files: [], status: 'failed' });
    await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('consumer-temporary');
  });
});

test('does not publish result.json when evidence write, bounds, or its manifest is invalid', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    const failing: NodeOutputPublicationSystem = {
      link: async () => undefined,
      open: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
        writeFile: async () => {
          throw new Error('write failed');
        },
      }),
      openDirectory: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
      }),
      unlink: async () => undefined,
    };
    await expect(
      createNodeClaimedOutputPublisher(failing).publish(output, publication(outputDirectory)),
    ).resolves.toEqual({ files: [], status: 'failed' });

    const boundedOutput = await claimAt(directory, join(directory, 'bounded-output'));
    await expect(
      createNodeClaimedOutputPublisher().publish(boundedOutput, {
        ...publication(join(directory, 'bounded-output')),
        maxEventBytes: 1,
      }),
    ).resolves.toEqual({ files: [], status: 'failed' });

    const mismatchedOutput = await claimAt(directory, join(directory, 'mismatched-output'));
    await expect(
      createNodeClaimedOutputPublisher().publish(mismatchedOutput, {
        ...publication(join(directory, 'mismatched-output')),
        result: failedResultWithoutFile(join(directory, 'mismatched-output')),
      }),
    ).resolves.toEqual({
      files: ['events.ndjson', 'stdout.log', 'stderr.log'],
      status: 'failed',
    });
    await expect(readdir(join(directory, 'mismatched-output'))).resolves.not.toContain(
      'result.json',
    );
  });
});

test('reports uncertain non-replacing commit without claiming result.json was persisted', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    let commits = 0;
    const uncertainAtResult: NodeOutputPublicationSystem = {
      link: async () => {
        commits += 1;
        if (commits === 4) throw Object.assign(new Error('unknown outcome'), { code: 'EIO' });
      },
      open: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
        writeFile: async () => undefined,
      }),
      openDirectory: async () => ({
        close: async () => undefined,
        sync: async () => undefined,
      }),
      unlink: async () => undefined,
    };

    await expect(
      createNodeClaimedOutputPublisher(uncertainAtResult).publish(
        output,
        publication(join(directory, 'output')),
      ),
    ).resolves.toEqual({
      files: ['events.ndjson', 'stdout.log', 'stderr.log'],
      status: 'uncertain',
    });
  });
});

test('does not expose result.json until its non-replacing commit is attempted last', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = await claim(directory);
    const outputDirectory = join(directory, 'output');
    const observingSystem: NodeOutputPublicationSystem = {
      link: async (temporaryPath, finalPath) => {
        if (basename(finalPath) === 'result.json')
          await expect(readdir(outputDirectory)).resolves.not.toContain('result.json');
        await link(temporaryPath, finalPath);
      },
      open: (path, flags, mode) => open(path, flags, mode),
      openDirectory: (path) => open(path, 'r'),
      unlink,
    };

    await expect(
      createNodeClaimedOutputPublisher(observingSystem).publish(
        output,
        publication(outputDirectory),
      ),
    ).resolves.toMatchObject({ status: 'published' });
  });
});
