import type { AgentDetector, AgentDetectorContext } from '../../contracts/discovery.js';
import type { DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemOverrideUnavailable, unavailableModels } from '../provider-diagnostics.js';
import { cursorAcpDefinition, cursorPackagePolicy } from './definition.js';

const unavailableExecutable = Object.freeze({
  code: 'system_executable_unavailable',
  message: 'Cursor ACP system package is unavailable.',
  severity: 'warning' as const,
});

export const createCursorDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector => {
  const override = options.systemExecutableOverrides?.cursor;
  return Object.freeze({
    id: 'cursor',
    detect: async ({ signal }: AgentDetectorContext) => {
      const packageLayout = await platform.resolveAdjacentNodePackage(
        cursorPackagePolicy,
        override,
        signal,
      );
      if (packageLayout === undefined) {
        const diagnostic =
          override === undefined ? unavailableExecutable : systemOverrideUnavailable('cursor');
        return Object.freeze({ candidates: [], diagnostics: [diagnostic] });
      }
      return Object.freeze({
        candidates: [
          {
            definition: cursorAcpDefinition(packageLayout.node, packageLayout.entrypoint),
            models: [],
          },
        ],
        diagnostics: [unavailableModels],
      });
    },
  });
};
