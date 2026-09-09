import { dirname, toNamespacedPath } from 'node:path';

import { withNativeResource } from '../../../../process/resources.js';

/** Native operations needed to create one output leaf with private inherited permissions. */
export interface WindowsOutputNative {
  getLastError(): number;
  closeHandle(handle: bigint): number;
  localFree(handle: bigint): bigint | null;
  getCurrentProcess(): bigint;
  openToken(process: bigint, access: number, token: (bigint | null)[]): number;
  getTokenInformation(
    token: bigint,
    informationClass: number,
    information: Buffer | null,
    length: number,
    required: number[],
  ): number;
  sidToString(sid: bigint, text: (bigint | null)[]): number;
  descriptorFromString(
    text: string,
    revision: number,
    descriptor: (bigint | null)[],
    size: null,
  ): number;
  createDirectory(path: string, attributes: Buffer): number;
  openDirectory(
    path: string,
    access: number,
    share: number,
    attributes: null,
    disposition: number,
    flags: number,
    template: null,
  ): bigint;
  getVolumeInformation(
    handle: bigint,
    name: null,
    nameLength: number,
    serial: null,
    componentLength: null,
    flags: number[],
    fsName: null,
    fsNameLength: number,
  ): number;
  decodePointer(data: Buffer): unknown;
  decodeString(pointer: bigint): unknown;
  encodeSecurityAttributes(descriptor: bigint): Buffer;
}

const windowsError = (native: WindowsOutputNative, operation: string): Error => {
  const code = native.getLastError();
  let mapped = 'EIO';
  if (code === 183 || code === 80) mapped = 'EEXIST';
  else if (code === 3 || code === 2) mapped = 'ENOENT';
  return Object.assign(new Error(`${operation} failed: win32=${code}`), { code: mapped });
};

const requireSuccess = (native: WindowsOutputNative, result: number, operation: string): void => {
  if (result === 0) throw windowsError(native, operation);
};

const freeAllocation = (native: WindowsOutputNative, handle: bigint, purpose: string): void => {
  if (native.localFree(handle) !== null) throw windowsError(native, `LocalFree(${purpose})`);
};

const processUserSid = (native: WindowsOutputNative): string => {
  const tokens: (bigint | null)[] = [null];
  requireSuccess(
    native,
    native.openToken(native.getCurrentProcess(), 0x0008, tokens),
    'OpenProcessToken',
  );
  const token = tokens[0]!;
  if (token === null) throw new Error('OpenProcessToken returned no token.');
  return withNativeResource(
    () => {
      const required = [0];
      if (
        native.getTokenInformation(token, 1, null, 0, required) !== 0 ||
        native.getLastError() !== 122
      )
        throw windowsError(native, 'GetTokenInformation(size)');
      const information = Buffer.alloc(required[0]!);
      requireSuccess(
        native,
        native.getTokenInformation(token, 1, information, information.length, required),
        'GetTokenInformation',
      );
      const sid: unknown = native.decodePointer(information);
      if (typeof sid !== 'bigint') throw new Error('Token user returned no SID.');
      const strings: (bigint | null)[] = [null];
      requireSuccess(native, native.sidToString(sid, strings), 'ConvertSidToStringSidW');
      const text = strings[0]!;
      if (text === null) throw new Error('ConvertSidToStringSidW returned no SID.');
      return withNativeResource(
        () => {
          const value: unknown = native.decodeString(text);
          if (typeof value !== 'string') throw new Error('Token user SID is not a string.');
          return value;
        },
        () => freeAllocation(native, text, 'SID'),
      );
    },
    () => requireSuccess(native, native.closeHandle(token), 'CloseHandle(token)'),
  );
};

const requirePersistentPermissions = (native: WindowsOutputNative, parent: string): void => {
  const handle = native.openDirectory(toNamespacedPath(parent), 0x80, 7, null, 3, 0x02000000, null);
  if (handle === -1n || handle === 0xffffffffffffffffn)
    throw windowsError(native, 'CreateFileW(directory)');
  withNativeResource(
    () => {
      const flags = [0];
      requireSuccess(
        native,
        native.getVolumeInformation(handle, null, 0, null, null, flags, null, 0),
        'GetVolumeInformationByHandleW',
      );
      if ((flags[0]! & 0x00000008) === 0)
        throw new Error('Output volume cannot enforce private permissions.');
    },
    () => requireSuccess(native, native.closeHandle(handle), 'CloseHandle(directory)'),
  );
};

export const createWindowsPrivateDirectory = (path: string, native: WindowsOutputNative): void => {
  requirePersistentPermissions(native, dirname(path));
  const sid = processUserSid(native);
  const descriptors: (bigint | null)[] = [null];
  // Protected DACL prevents inherited access; child files inherit only the current user's ACE.
  requireSuccess(
    native,
    native.descriptorFromString(`O:${sid}D:P(A;OICI;FA;;;${sid})`, 1, descriptors, null),
    'ConvertStringSecurityDescriptorToSecurityDescriptorW',
  );
  const descriptor = descriptors[0]!;
  if (descriptor === null)
    throw new Error('Security descriptor conversion returned no descriptor.');
  withNativeResource(
    () => {
      const attributes = native.encodeSecurityAttributes(descriptor);
      requireSuccess(
        native,
        native.createDirectory(toNamespacedPath(path), attributes),
        'CreateDirectoryW',
      );
    },
    () => freeAllocation(native, descriptor, 'security descriptor'),
  );
};
