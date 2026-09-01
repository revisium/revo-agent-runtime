import type { AgentDetector, AgentDetectorContext } from '../contracts/discovery.js';
import {
  defaultSystemExecutableProbe,
  type BridgePackagePolicy,
  type DiscoveryPlatform,
} from '../discovery/platform.js';
import { acpDefinition } from './acp-definition.js';
import {
  bundledBridgeUnavailable,
  systemOverrideUnavailable,
  unavailableModels,
} from './provider-diagnostics.js';

export interface BundledAcpProviderPolicy {
  readonly bridge: BridgePackagePolicy;
  readonly detectorId: string;
  readonly displayName: string;
  readonly id: string;
  readonly systemOverrideVersionProbePrefix?: string;
  readonly version: string;
}

const definitionFor = (
  policy: BundledAcpProviderPolicy,
  command: string,
  args: readonly string[],
  versionProbePrefix: string | undefined,
) =>
  acpDefinition({
    args,
    command,
    displayName: policy.displayName,
    id: policy.id,
    version: policy.version,
    ...(versionProbePrefix === undefined ? {} : { versionProbePrefix }),
  });

/** Resolves an exact provider bridge or a deliberately selected system override. */
export const bundledBridgeDetector = (
  policy: BundledAcpProviderPolicy,
  systemOverride: string | undefined,
  platform: DiscoveryPlatform,
): AgentDetector =>
  Object.freeze({
    id: policy.detectorId,
    detect: async ({ signal }: AgentDetectorContext) => {
      if (systemOverride !== undefined) {
        const executable = await platform.resolveSystemOverride(
          systemOverride,
          defaultSystemExecutableProbe,
          signal,
        );
        if (executable === undefined)
          return Object.freeze({
            candidates: [],
            diagnostics: [systemOverrideUnavailable(policy.detectorId)],
          });
        return Object.freeze({
          candidates: [
            {
              definition: definitionFor(
                policy,
                executable,
                [],
                policy.systemOverrideVersionProbePrefix,
              ),
              models: [],
            },
          ],
          diagnostics: [unavailableModels],
        });
      }
      const bridge = platform.resolveBundledBridge(policy.bridge);
      if (!bridge.available)
        return Object.freeze({ candidates: [], diagnostics: [bundledBridgeUnavailable()] });
      return Object.freeze({
        candidates: [
          {
            definition: definitionFor(policy, process.execPath, [bridge.entrypoint], 'v'),
            models: [],
          },
        ],
        diagnostics: [unavailableModels],
      });
    },
  });
