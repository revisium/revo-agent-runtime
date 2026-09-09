import type { AgentDetector, AgentDetectorContext } from '../contracts/discovery.js';
import type {
  BridgePackagePolicy,
  DiscoveryPlatform,
  InstalledCliPolicy,
} from '../discovery/platform.js';
import { acpDefinition } from './acp-definition.js';
import {
  bundledBridgeUnavailable,
  systemOverrideUnavailable,
  unavailableModels,
} from './provider-diagnostics.js';

export interface BundledAcpProviderPolicy {
  readonly bridge: BridgePackagePolicy;
  readonly cli: InstalledCliPolicy;
  readonly cliEnvironmentVariable: string;
  readonly cliVersionPrefix?: string;
  readonly detectorId: string;
  readonly displayName: string;
  readonly id: string;
  readonly version: string;
}

/** Ships the ACP adapter, while always selecting the user's installed CLI. */
export const bundledBridgeDetector = (
  policy: BundledAcpProviderPolicy,
  override: string | undefined,
  platform: DiscoveryPlatform,
): AgentDetector =>
  Object.freeze({
    id: policy.detectorId,
    detect: async ({ signal }: AgentDetectorContext) => {
      const executable = await platform.resolveInstalledCli(policy.cli, override, signal);
      if (executable === undefined)
        return {
          candidates: [],
          diagnostics: [
            override === undefined
              ? {
                  code: 'system_executable_unavailable',
                  message: `Installed ${policy.cli.command} CLI is unavailable.`,
                  severity: 'warning' as const,
                }
              : systemOverrideUnavailable(policy.detectorId),
          ],
        };
      const bridge = platform.resolveBundledBridge(policy.bridge);
      if (!bridge.available) return { candidates: [], diagnostics: [bundledBridgeUnavailable()] };
      return {
        candidates: [
          {
            definition: acpDefinition({
              args: [bridge.entrypoint],
              command: process.execPath,
              displayName: policy.displayName,
              id: policy.id,
              version: policy.version,
              environment: { [policy.cliEnvironmentVariable]: executable },
              versionProbeCommand: executable,
              versionProbeTimeoutMs: 5_000,
              ...(policy.cliVersionPrefix === undefined
                ? {}
                : { versionProbePrefix: policy.cliVersionPrefix }),
            }),
            models: [],
          },
        ],
        diagnostics: [unavailableModels],
      };
    },
  });
