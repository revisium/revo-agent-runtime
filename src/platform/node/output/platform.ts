import { mkdir, open } from 'node:fs/promises';

export const createPrivateDirectory = async (
  path: string,
  options: Readonly<{ mode: number; recursive: false }>,
) => {
  if (process.platform !== 'win32') return mkdir(path, options);
  const { createWindowsPrivateDirectory } = await import('./windows/private-directory.js');
  const { windowsOutputNative } = await import('./windows/native.js');
  return createWindowsPrivateDirectory(path, windowsOutputNative);
};

// Windows FlushFileBuffers requires write access, including for directory metadata.
export const openOutputDirectory = (path: string) =>
  open(path, process.platform === 'win32' ? 'r+' : 'r');
