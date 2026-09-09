import type { WindowsOutputNative } from '../../../src/platform/node/output/windows/private-directory.js';

type FailureOperation =
  | 'closeHandle'
  | 'openToken'
  | 'getTokenInformation'
  | 'sidToString'
  | 'descriptorFromString'
  | 'createDirectory'
  | 'getVolumeInformation';

export const windowsOutputFixture = () => {
  const owned = new Set<bigint>();
  const descriptors: string[] = [];
  const created: string[] = [];
  const closed: bigint[] = [];
  let errorCode = 122;
  const native: WindowsOutputNative = {
    getLastError: () => errorCode,
    getCurrentProcess: () => 1n,
    openDirectory: () => {
      owned.add(2n);
      return 2n;
    },
    closeHandle: (handle) => {
      closed.push(handle);
      owned.delete(handle);
      return 1;
    },
    getVolumeInformation: (_handle, _name, _nameLength, _serial, _componentLength, flags) => {
      flags[0] = 8;
      return 1;
    },
    openToken: (_process, _access, tokens) => {
      owned.add(3n);
      tokens[0] = 3n;
      return 1;
    },
    getTokenInformation: (_token, _informationClass, information, _length, required) => {
      required[0] = 32;
      return information === null ? 0 : 1;
    },
    decodePointer: () => 4n,
    sidToString: (_sid, strings) => {
      owned.add(5n);
      strings[0] = 5n;
      return 1;
    },
    decodeString: () => 'S-1-5-21-123-456-789-1000',
    localFree: (handle) => {
      owned.delete(handle);
      return null;
    },
    descriptorFromString: (text, _revision, pointers) => {
      descriptors.push(text);
      owned.add(6n);
      pointers[0] = 6n;
      return 1;
    },
    encodeSecurityAttributes: () => Buffer.alloc(24),
    createDirectory: (path) => {
      created.push(path);
      return 1;
    },
  };
  return {
    native,
    owned,
    descriptors,
    created,
    closed,
    fail(operation: FailureOperation, code = 5) {
      native[operation] = () => {
        errorCode = code;
        return 0;
      };
    },
    failTokenRead() {
      native.getTokenInformation = (_token, _class, information, _length, required) => {
        required[0] = 32;
        errorCode = information === null ? 122 : 5;
        return 0;
      };
    },
  };
};
