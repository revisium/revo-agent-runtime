import { open, unlink } from 'node:fs/promises';

import type {
  OutputArtifactPlatform,
  PrivateFileCreation,
} from '../../../execution/output/artifact.js';
import { nodeErrorCode } from '../../../process/resources.js';

interface PrivateFileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface NodeOutputArtifactSystem {
  open(path: string, flags: 'wx', mode: number): Promise<PrivateFileHandle>;
  unlink(path: string): Promise<void>;
}

const nodeOutputArtifactSystem: NodeOutputArtifactSystem = Object.freeze({
  open: async (path: string, flags: 'wx', mode: number): Promise<PrivateFileHandle> =>
    open(path, flags, mode),
  unlink,
});

const closeQuietly = async (handle: PrivateFileHandle): Promise<void> => {
  try {
    await handle.close();
  } catch {
    // The write outcome already decided the result.
  }
};

export const createNodeOutputArtifactPlatform = (
  system: NodeOutputArtifactSystem = nodeOutputArtifactSystem,
): OutputArtifactPlatform =>
  Object.freeze({
    createPrivateFile: async (path: string, bytes: Uint8Array): Promise<PrivateFileCreation> => {
      let handle: PrivateFileHandle;
      try {
        handle = await system.open(path, 'wx', 0o600);
      } catch (error) {
        return nodeErrorCode(error) === 'EEXIST' ? 'conflict' : 'failed';
      }
      try {
        await handle.writeFile(bytes);
        await handle.close();
        return 'created';
      } catch {
        await closeQuietly(handle);
        await system.unlink(path).catch(() => undefined);
        return 'failed';
      }
    },
    removeFile: (path: string): Promise<void> => system.unlink(path),
  });

export const nodeOutputArtifactPlatform = createNodeOutputArtifactPlatform();
