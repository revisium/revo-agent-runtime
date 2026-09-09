import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BridgePackagePolicy } from '../../../discovery/platform.js';

/** Build-owned JavaScript adapters contain no vendor CLI executable. */
export const resolveBundledBridge = (
  policy: BridgePackagePolicy,
  directory = fileURLToPath(new URL('../../../../adapters/', import.meta.url)),
):
  | { readonly available: true; readonly entrypoint: string }
  | { readonly available: false; readonly reason: string } => {
  try {
    const entrypoint = realpathSync.native(join(directory, `${policy.binName}.mjs`));
    if (!statSync(entrypoint).isFile()) return { available: false, reason: 'entrypoint_invalid' };
    accessSync(entrypoint, constants.R_OK);
    return { available: true, entrypoint };
  } catch {
    return { available: false, reason: 'entrypoint_invalid' };
  }
};
