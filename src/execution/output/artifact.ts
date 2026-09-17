export type PrivateFileCreation = 'created' | 'conflict' | 'failed';

/** Exclusive 0600 file creation inside an already claimed output directory, plus removal. */
export interface OutputArtifactPlatform {
  createPrivateFile(path: string, bytes: Uint8Array): Promise<PrivateFileCreation>;
  removeFile(path: string): Promise<void>;
}

/** A runtime-owned transient file; removal is idempotent and never surfaces a fault. */
export interface PrivateOutputArtifact {
  readonly path: string;
  dispose(): Promise<void>;
}

export const createPrivateOutputArtifact = async (
  platform: OutputArtifactPlatform,
  path: string,
  bytes: Uint8Array,
): Promise<PrivateOutputArtifact | undefined> => {
  let created: PrivateFileCreation;
  try {
    created = await platform.createPrivateFile(path, bytes);
  } catch {
    return undefined;
  }
  if (created !== 'created') return undefined;
  let disposal: Promise<void> | undefined;
  return Object.freeze({
    path,
    dispose: (): Promise<void> => {
      disposal ??= platform.removeFile(path).catch(() => undefined);
      return disposal;
    },
  });
};
