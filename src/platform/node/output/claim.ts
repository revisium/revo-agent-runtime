import { mkdir, stat } from 'node:fs/promises';

import type {
  DirectoryInspection,
  ExclusiveDirectoryCreation,
  OutputClaimPlatform,
} from '../../../execution/output/claim.js';
import { nodeErrorCode } from '../process/errors.js';

export interface NodeOutputClaimSystem {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  mkdir(path: string, options: Readonly<{ mode: number; recursive: false }>): Promise<unknown>;
}

const nodeOutputClaimSystem: NodeOutputClaimSystem = Object.freeze({
  mkdir,
  stat,
});

const missingPath = (error: unknown): boolean => {
  const code = nodeErrorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
};

export const createNodeOutputClaimPlatform = (
  system: NodeOutputClaimSystem = nodeOutputClaimSystem,
): OutputClaimPlatform =>
  Object.freeze({
    inspectDirectory: async (path: string): Promise<DirectoryInspection> => {
      try {
        return (await system.stat(path)).isDirectory() ? 'directory' : 'not_directory';
      } catch (error) {
        return missingPath(error) ? 'missing' : 'uncertain';
      }
    },
    createExclusiveDirectory: async (path: string): Promise<ExclusiveDirectoryCreation> => {
      try {
        await system.mkdir(path, { mode: 0o700, recursive: false });
        return 'created';
      } catch (error) {
        const code = nodeErrorCode(error);
        if (code === 'EEXIST') return 'conflict';
        if (missingPath(error)) return 'invalid_path';
        return 'uncertain';
      }
    },
  });

export const nodeOutputClaimPlatform = createNodeOutputClaimPlatform();
