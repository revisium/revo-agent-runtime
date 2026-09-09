import koffi from 'koffi';

import type { WindowsOutputNative } from './private-directory.js';

const kernel = koffi.load('kernel32.dll');
const security = koffi.load('advapi32.dll');
const securityAttributes = koffi.struct({
  length: 'uint32_t',
  descriptor: 'void *',
  inherit: 'int',
});

export const windowsOutputNative: WindowsOutputNative = {
  getLastError: kernel.func(
    'uint32_t __stdcall GetLastError()',
  ) as WindowsOutputNative['getLastError'],
  closeHandle: kernel.func(
    'int __stdcall CloseHandle(void *)',
  ) as WindowsOutputNative['closeHandle'],
  localFree: kernel.func('void * __stdcall LocalFree(void *)') as WindowsOutputNative['localFree'],
  getCurrentProcess: kernel.func(
    'void * __stdcall GetCurrentProcess()',
  ) as WindowsOutputNative['getCurrentProcess'],
  openToken: security.func(
    'int __stdcall OpenProcessToken(void *, uint32_t, _Out_ void **)',
  ) as WindowsOutputNative['openToken'],
  getTokenInformation: security.func(
    'int __stdcall GetTokenInformation(void *, int, void *, uint32_t, _Out_ uint32_t *)',
  ) as WindowsOutputNative['getTokenInformation'],
  sidToString: security.func(
    'int __stdcall ConvertSidToStringSidW(void *, _Out_ void **)',
  ) as WindowsOutputNative['sidToString'],
  descriptorFromString: security.func(
    'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *, uint32_t, _Out_ void **, void *)',
  ) as WindowsOutputNative['descriptorFromString'],
  createDirectory: kernel.func(
    'int __stdcall CreateDirectoryW(const char16_t *, void *)',
  ) as WindowsOutputNative['createDirectory'],
  openDirectory: kernel.func(
    'void * __stdcall CreateFileW(const char16_t *, uint32_t, uint32_t, void *, uint32_t, uint32_t, void *)',
  ) as WindowsOutputNative['openDirectory'],
  getVolumeInformation: kernel.func(
    'int __stdcall GetVolumeInformationByHandleW(void *, void *, uint32_t, void *, void *, _Out_ uint32_t *, void *, uint32_t)',
  ) as WindowsOutputNative['getVolumeInformation'],
  decodePointer: (data): unknown => koffi.decode(data, 'void *'),
  decodeString: (pointer): unknown => koffi.decode(pointer, 'char16_t', -1),
  encodeSecurityAttributes: (descriptor) => {
    const attributes = Buffer.alloc(koffi.sizeof(securityAttributes));
    koffi.encode(attributes, securityAttributes, {
      length: attributes.length,
      descriptor,
      inherit: 0,
    });
    return attributes;
  },
};
