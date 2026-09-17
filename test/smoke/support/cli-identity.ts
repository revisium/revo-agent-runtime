import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { builtInProviderIds, type BuiltInProviderId } from './provider-selection.js';

export const pinNodeRuntimeWithoutVendorShadow = (path: string, nodeBin: string): string => {
  const parts = path.split(delimiter).filter((entry) => entry.length > 0 && entry !== nodeBin);
  return [...parts, nodeBin].join(delimiter);
};

export const canonicalExecutableOnPath = (command: string, path: string): string | undefined => {
  for (const directory of path.split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, command);
    try {
      accessSync(candidate, constants.R_OK | constants.X_OK);
      return realpathSync.native(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
};

export const liveDiscoveryOptions = (
  provider: BuiltInProviderId,
  executable: string | undefined,
) => ({
  disabledDetectorIds: builtInProviderIds.filter((id) => id !== provider),
  ...(executable === undefined ? {} : { systemExecutableOverrides: { [provider]: executable } }),
});

export const formatCliIdentity = (
  providerId: string,
  executable: string,
  version: string,
): string => `${providerId}: cli=${executable}; version=${version}`;
