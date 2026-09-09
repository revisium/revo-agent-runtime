import { resolve, toNamespacedPath } from 'node:path';

import { expect, test } from 'vitest';

import { createWindowsPrivateDirectory } from '../../../../../src/platform/node/output/windows/private-directory.js';
import { windowsOutputFixture } from '../../../../support/fixtures/windows-output.js';

const directory = resolve('/output/private');

test('creates a protected output leaf whose child files grant access only to the runtime user', () => {
  const fixture = windowsOutputFixture();

  createWindowsPrivateDirectory(directory, fixture.native);

  expect(fixture.created).toEqual([toNamespacedPath(directory)]);
  expect(fixture.descriptors).toEqual([
    'O:S-1-5-21-123-456-789-1000D:P(A;OICI;FA;;;S-1-5-21-123-456-789-1000)',
  ]);
  expect(fixture.owned).toEqual(new Set());
});

test('refuses a volume without persistent permissions before creating output', () => {
  const fixture = windowsOutputFixture();
  fixture.native.getVolumeInformation = () => 1;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'cannot enforce private permissions',
  );
  expect(fixture.created).toEqual([]);
  expect(fixture.owned).toEqual(new Set());
});

test.each([-1n, 0xffffffffffffffffn])(
  'does not close an invalid parent directory handle %s',
  (handle) => {
    const fixture = windowsOutputFixture();
    fixture.native.openDirectory = () => handle;

    expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
      'CreateFileW(directory) failed',
    );
    expect(fixture.closed).toEqual([]);
    expect(fixture.created).toEqual([]);
  },
);

test.each([
  'getVolumeInformation',
  'openToken',
  'getTokenInformation',
  'sidToString',
  'descriptorFromString',
  'createDirectory',
] as const)('releases acquired resources when %s fails', (operation) => {
  const fixture = windowsOutputFixture();
  fixture.fail(operation);

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow('win32=5');
  expect(fixture.owned).toEqual(new Set());
  expect(fixture.created).toEqual([]);
});

test('releases the token when reading user information fails after the size query', () => {
  const fixture = windowsOutputFixture();
  fixture.failTokenRead();

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'GetTokenInformation failed',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('rejects an unexpected successful token size query', () => {
  const fixture = windowsOutputFixture();
  fixture.native.getTokenInformation = () => 1;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'GetTokenInformation(size) failed',
  );
  expect(fixture.owned).toEqual(new Set());
});

test.each([
  [183, 'EEXIST'],
  [80, 'EEXIST'],
  [3, 'ENOENT'],
  [2, 'ENOENT'],
  [5, 'EIO'],
])(
  'maps native directory error %i to %s while releasing the security descriptor',
  (nativeCode, code) => {
    const fixture = windowsOutputFixture();
    fixture.fail('createDirectory', nativeCode);

    expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
      expect.objectContaining({ code }),
    );
    expect(fixture.owned).toEqual(new Set());
  },
);

test('does not hide a native handle close failure', () => {
  const fixture = windowsOutputFixture();
  fixture.fail('closeHandle');

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'CloseHandle(directory) failed',
  );
  expect(fixture.created).toEqual([]);
});

test('rejects a missing process token without using it', () => {
  const fixture = windowsOutputFixture();
  fixture.native.openToken = () => 1;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'returned no token',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('releases the token when the native user SID pointer is unusable', () => {
  const fixture = windowsOutputFixture();
  fixture.native.decodePointer = () => null;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'Token user returned no SID',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('releases the token when SID conversion returns no allocation', () => {
  const fixture = windowsOutputFixture();
  fixture.native.sidToString = () => 1;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'ConvertSidToStringSidW returned no SID',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('releases SID memory and the token when the SID string cannot be decoded', () => {
  const fixture = windowsOutputFixture();
  fixture.native.decodeString = () => null;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'Token user SID is not a string',
  );
  expect(fixture.owned).toEqual(new Set());
});

test('does not create output when the security descriptor is absent', () => {
  const fixture = windowsOutputFixture();
  fixture.native.descriptorFromString = () => 1;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'returned no descriptor',
  );
  expect(fixture.owned).toEqual(new Set());
  expect(fixture.created).toEqual([]);
});

test('reports a failed SID memory release while still closing the process token', () => {
  const fixture = windowsOutputFixture();
  fixture.native.localFree = () => 5n;

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    'LocalFree(SID) failed',
  );
  expect(fixture.owned).not.toContain(3n);
});

test('preserves both a directory inspection failure and its cleanup failure', () => {
  const fixture = windowsOutputFixture();
  fixture.fail('getVolumeInformation');
  fixture.fail('closeHandle');

  expect(() => createWindowsPrivateDirectory(directory, fixture.native)).toThrow(
    expect.objectContaining({
      errors: [
        expect.objectContaining({ message: 'GetVolumeInformationByHandleW failed: win32=5' }),
        expect.objectContaining({ message: 'CloseHandle(directory) failed: win32=5' }),
      ],
    }),
  );
});
