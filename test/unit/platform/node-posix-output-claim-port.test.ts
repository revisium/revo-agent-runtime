import { existsSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { NodePosixOutputClaimPort } from '../../../src/platform/process/index.js';
import type {
  OutputClaimExclusiveCreateRequest,
  OutputClaimPlatformResult,
} from '../../../src/runtime/execution/index.js';

let temporaryRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const createTemporaryRoot = async (): Promise<string> => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-output-claim-'));
  return temporaryRoot;
};

const request = (
  outputDirectory: string,
  markSyscallDispatched = vi.fn(),
): OutputClaimExclusiveCreateRequest =>
  Object.freeze({
    invocationId: 'output-claim',
    outputDirectory,
    markSyscallDispatched,
  });

const expectMissing = async (path: string): Promise<void> => {
  await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
};

type PartialOutputClaimRequest = Partial<Record<keyof OutputClaimExclusiveCreateRequest, unknown>>;

const createExclusiveOutputDirectoryFromPartial = (
  port: NodePosixOutputClaimPort,
  partialRequest: PartialOutputClaimRequest,
): Promise<OutputClaimPlatformResult> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  port.createExclusiveOutputDirectory(partialRequest as OutputClaimExclusiveCreateRequest);

test('creates an absent Linux output leaf exactly once', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'invocation-output');
  const markSyscallDispatched = vi.fn();
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
  ).resolves.toEqual({ status: 'created' });
  expect((await stat(outputDirectory)).isDirectory()).toBe(true);
  expect(markSyscallDispatched).toHaveBeenCalledOnce();
});

test('reports an existing directory leaf without adopting or overwriting it', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'existing-output');
  const sentinel = join(outputDirectory, 'sentinel.txt');
  const markSyscallDispatched = vi.fn();
  await mkdir(outputDirectory);
  await writeFile(sentinel, 'keep');
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
  ).resolves.toEqual({ status: 'leaf_exists' });
  await expect(readFile(sentinel, 'utf8')).resolves.toBe('keep');
  expect(markSyscallDispatched).toHaveBeenCalledOnce();
});

test('reports an existing file leaf without changing content', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'file-output');
  await writeFile(outputDirectory, 'original');
  const markSyscallDispatched = vi.fn();
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
  ).resolves.toEqual({ status: 'leaf_exists' });
  await expect(readFile(outputDirectory, 'utf8')).resolves.toBe('original');
  expect(markSyscallDispatched).toHaveBeenCalledOnce();
});

test('reports a dangling symlink leaf without changing its target', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'dangling-output-link');
  const target = join(root, 'missing-target');
  await symlink(target, outputDirectory);
  const markSyscallDispatched = vi.fn();
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
  ).resolves.toEqual({ status: 'leaf_exists' });
  await expect(readlink(outputDirectory)).resolves.toBe(target);
  expect(markSyscallDispatched).toHaveBeenCalledOnce();
});

test('does not create a missing parent', async () => {
  const root = await createTemporaryRoot();
  const parent = join(root, 'missing-parent');
  const port = new NodePosixOutputClaimPort();

  await expect(port.createExclusiveOutputDirectory(request(join(parent, 'leaf')))).resolves.toEqual(
    { status: 'create_failed' },
  );
  await expectMissing(parent);
});

test('does not create nested missing ancestors', async () => {
  const root = await createTemporaryRoot();
  const ancestor = join(root, 'missing-ancestor');
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(join(ancestor, 'child', 'leaf'))),
  ).resolves.toEqual({ status: 'create_failed' });
  await expectMissing(ancestor);
});

test('reports create failure when the parent is a regular file', async () => {
  const root = await createTemporaryRoot();
  const parent = join(root, 'file-parent');
  await writeFile(parent, 'not a directory');
  const port = new NodePosixOutputClaimPort();

  await expect(port.createExclusiveOutputDirectory(request(join(parent, 'leaf')))).resolves.toEqual(
    { status: 'create_failed' },
  );
});

const testIfNotRoot = process.getuid?.() === 0 ? test.skip : test;

testIfNotRoot('reports create failure for a non-writable parent', async () => {
  const root = await createTemporaryRoot();
  const parent = join(root, 'readonly-parent');
  await mkdir(parent);
  await chmod(parent, 0o500);
  const port = new NodePosixOutputClaimPort();

  await expect(port.createExclusiveOutputDirectory(request(join(parent, 'leaf')))).resolves.toEqual(
    { status: 'create_failed' },
  );
  await chmod(parent, 0o700);
});

test.each([
  'relative/output',
  '/tmp/../output',
  `/tmp/${'x'.repeat(4_097)}`,
  '/tmp/hostile\u0000output',
  '/',
  '/tmp/output/',
])('rejects invalid path %s before dispatch', async (outputDirectory) => {
  const markSyscallDispatched = vi.fn();
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
  ).resolves.toEqual({ status: 'create_failed' });
  expect(markSyscallDispatched).not.toHaveBeenCalled();
  if (outputDirectory.startsWith('/tmp/') && !outputDirectory.includes('\u0000')) {
    if (outputDirectory.length <= 4_096) await expectMissing(outputDirectory);
  }
});

test('rejects non-string outputDirectory before dispatch without touching the filesystem', async () => {
  const root = await createTemporaryRoot();
  const markSyscallDispatched = vi.fn();
  const port = new NodePosixOutputClaimPort();
  const malformedRequest = Object.freeze({
    invocationId: 'output-claim',
    outputDirectory: Object.freeze({ path: join(root, 'leaf') }),
    markSyscallDispatched,
  }) satisfies PartialOutputClaimRequest;

  await expect(createExclusiveOutputDirectoryFromPartial(port, malformedRequest)).resolves.toEqual({
    status: 'create_failed',
  });
  expect(markSyscallDispatched).not.toHaveBeenCalled();
  await expectMissing(join(root, 'leaf'));
});

test('rejects non-function markSyscallDispatched before dispatch without creating the leaf', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'invalid-marker-output');
  const port = new NodePosixOutputClaimPort();
  const malformedRequest = Object.freeze({
    invocationId: 'output-claim',
    outputDirectory,
    markSyscallDispatched: 'not a function',
  }) satisfies PartialOutputClaimRequest;

  await expect(createExclusiveOutputDirectoryFromPartial(port, malformedRequest)).resolves.toEqual({
    status: 'create_failed',
  });
  await expectMissing(outputDirectory);
});

test.each(['darwin', 'win32'] as const)(
  'fails closed on unsupported platform %s without dispatch',
  async (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const root = await createTemporaryRoot();
    const outputDirectory = join(root, 'unsupported-output');
    const markSyscallDispatched = vi.fn();
    const port = new NodePosixOutputClaimPort();

    await expect(
      port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
    ).resolves.toEqual({ status: 'create_failed' });
    expect(markSyscallDispatched).not.toHaveBeenCalled();
    await expectMissing(outputDirectory);
  },
);

test('marks dispatch immediately before mkdir creates the leaf', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'ordered-output');
  const markSyscallDispatched = vi.fn(() => {
    expect(existsSync(outputDirectory)).toBe(false);
  });
  const port = new NodePosixOutputClaimPort();

  await expect(
    port.createExclusiveOutputDirectory(request(outputDirectory, markSyscallDispatched)),
  ).resolves.toEqual({ status: 'created' });
  expect(markSyscallDispatched).toHaveBeenCalledOnce();
});
