import { afterEach, expect, test, vi } from 'vitest';

import { NodePosixWorkspacePort } from '../../../src/platform/process/index.js';

afterEach(() => vi.restoreAllMocks());

test('admits an existing normalized absolute Linux workspace', async () => {
  const port = new NodePosixWorkspacePort();

  await expect(port.admit(process.cwd())).resolves.toEqual({
    status: 'admitted',
    directory: process.cwd(),
  });
});

test('rejects relative, non-normalized, oversized, and hostile workspace paths', async () => {
  const port = new NodePosixWorkspacePort();

  await expect(port.admit('relative/workspace')).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit('/tmp/../workspace')).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit(`/tmp/${'x'.repeat(4_097)}`)).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
  await expect(port.admit('/tmp/hostile\u0000workspace')).resolves.toEqual({
    status: 'rejected',
    reason: 'invalid_path',
  });
});

test('rejects missing and non-directory workspaces', async () => {
  const port = new NodePosixWorkspacePort();

  await expect(port.admit(`${process.cwd()}/missing-workspace`)).resolves.toEqual({
    status: 'rejected',
    reason: 'missing',
  });
  await expect(port.admit(__filename)).resolves.toEqual({
    status: 'rejected',
    reason: 'not_directory',
  });
});

test.each(['darwin', 'win32'] as const)(
  'rejects unsupported platform %s deterministically',
  async (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    const port = new NodePosixWorkspacePort();

    await expect(port.admit('/approved/workspace')).resolves.toEqual({
      status: 'rejected',
      reason: 'unsupported_platform',
    });
  },
);
