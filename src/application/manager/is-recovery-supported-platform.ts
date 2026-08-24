export const isRecoverySupportedPlatform = (): boolean =>
  process.platform === 'darwin' || process.platform === 'linux';
