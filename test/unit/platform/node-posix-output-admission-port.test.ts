import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { NodePosixOutputAdmissionPort } from '../../../src/platform/process/index.js';

let temporaryRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const createTemporaryRoot = async (): Promise<string> => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-output-admission-'));
  return temporaryRoot;
};

const request = (outputDirectory: string) =>
  Object.freeze({
    invocationId: 'output-admission',
    outputDirectory,
    needsPromptFile: true,
    needsResultSchemaFile: false,
  });

test('admits an absent normalized absolute Linux output leaf without creating it', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'invocation-output');
  const port = new NodePosixOutputAdmissionPort();

  await expect(port.admit(request(outputDirectory))).resolves.toEqual({
    status: 'admitted',
    plan: {
      invocationId: 'output-admission',
      outputDirectory,
      needsPromptFile: true,
      needsResultSchemaFile: false,
    },
  });
  await expect(rm(outputDirectory, { recursive: true })).rejects.toMatchObject({ code: 'ENOENT' });
});

test('rejects relative, non-normalized, oversized, hostile, and root output paths', async () => {
  const port = new NodePosixOutputAdmissionPort();

  await expect(port.admit(request('relative/output'))).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit(request('/tmp/../output'))).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit(request(`/tmp/${'x'.repeat(4_097)}`))).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit(request('/tmp/hostile\u0000output'))).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit(request('/'))).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
});

test('rejects missing and non-directory parents and existing leaves', async () => {
  const root = await createTemporaryRoot();
  const fileParent = join(root, 'file-parent');
  const existingLeaf = join(root, 'existing-leaf');
  await writeFile(fileParent, 'not a directory');
  await writeFile(existingLeaf, 'already here');
  const port = new NodePosixOutputAdmissionPort();

  await expect(port.admit(request(join(root, 'missing-parent', 'leaf')))).resolves.toEqual({
    status: 'rejected',
    reason: 'missing_parent',
  });
  await expect(port.admit(request(join(fileParent, 'leaf')))).resolves.toEqual({
    status: 'rejected',
    reason: 'parent_not_directory',
  });
  await expect(port.admit(request(existingLeaf))).resolves.toEqual({
    status: 'rejected',
    reason: 'leaf_exists',
  });
});

test('rejects a dangling symlink at the output leaf as an existing entry', async () => {
  const root = await createTemporaryRoot();
  const outputDirectory = join(root, 'dangling-output-link');
  await symlink(join(root, 'missing-target'), outputDirectory);
  const port = new NodePosixOutputAdmissionPort();

  await expect(port.admit(request(outputDirectory))).resolves.toEqual({
    status: 'rejected',
    reason: 'leaf_exists',
  });
});

test.each(['darwin', 'win32'] as const)(
  'rejects unsupported platform %s deterministically',
  async (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const port = new NodePosixOutputAdmissionPort();

    await expect(port.admit(request('/approved/output'))).resolves.toEqual({
      status: 'rejected',
      reason: 'unsupported_platform',
    });
  },
);
