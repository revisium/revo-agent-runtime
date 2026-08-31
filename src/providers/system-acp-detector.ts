import type { AgentDefinitionInput } from '../contracts/agent-definition.js';
import type {
  AgentDetector,
  AgentDetectorContext,
  AgentDetectorResult,
} from '../contracts/discovery.js';
import type { DiscoveryPlatform } from '../discovery/platform.js';
import type { SystemExecutableProbe } from '../discovery/platform.js';
import { unavailableModels, systemOverrideUnavailable } from './provider-diagnostics.js';

export interface SystemAcpProviderPolicy {
  readonly command: string;
  readonly detectorId: string;
  readonly unavailableMessage: string;
  readonly versionProbe: SystemExecutableProbe;
  definition(command: string): AgentDefinitionInput;
}

const unavailableExecutable = (message: string): AgentDetectorResult['diagnostics'][number] =>
  Object.freeze({
    code: 'system_executable_unavailable',
    message,
    severity: 'warning',
  });

export const systemAcpDetector = (
  policy: SystemAcpProviderPolicy,
  override: string | undefined,
  platform: DiscoveryPlatform,
): AgentDetector =>
  Object.freeze({
    id: policy.detectorId,
    detect: async ({ signal }: AgentDetectorContext) => {
      const executable =
        override === undefined
          ? await platform.resolveSystemExecutable(policy.command)
          : await platform.resolveSystemOverride(override, policy.versionProbe, signal);
      const available =
        executable !== undefined &&
        (override !== undefined ||
          (await platform.probeSystemExecutable(executable, policy.versionProbe, signal)));
      if (!available || executable === undefined) {
        const diagnostic =
          override === undefined
            ? unavailableExecutable(policy.unavailableMessage)
            : systemOverrideUnavailable(policy.detectorId);
        return Object.freeze({ candidates: [], diagnostics: [diagnostic] });
      }
      return Object.freeze({
        candidates: [{ definition: policy.definition(executable), models: [] }],
        diagnostics: [unavailableModels],
      });
    },
  });
