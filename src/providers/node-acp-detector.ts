import type { AgentDefinitionInput } from '../contracts/agent-definition.js';
import type { AgentDetector, AgentDetectorContext } from '../contracts/discovery.js';
import type { DiscoveryPlatform, NodePackageEntrypointPolicy } from '../discovery/platform.js';
import { systemOverrideUnavailable, unavailableModels } from './provider-diagnostics.js';

export interface NodeAcpProviderPolicy {
  readonly detectorId: string;
  readonly nodePackage: NodePackageEntrypointPolicy;
  readonly unavailableMessage: string;
  definition(entrypoint: string): AgentDefinitionInput;
}

const unavailableExecutable = (message: string) =>
  Object.freeze({
    code: 'system_executable_unavailable',
    message,
    severity: 'warning' as const,
  });

/** Discovers one provider-owned Node package without using its shell launcher. */
export const nodeAcpDetector = (
  policy: NodeAcpProviderPolicy,
  override: string | undefined,
  platform: DiscoveryPlatform,
): AgentDetector =>
  Object.freeze({
    id: policy.detectorId,
    detect: async ({ signal }: AgentDetectorContext) => {
      const entrypoint = await platform.resolveNodePackageEntrypoint(
        policy.nodePackage,
        override,
        signal,
      );
      if (entrypoint === undefined) {
        const diagnostic =
          override === undefined
            ? unavailableExecutable(policy.unavailableMessage)
            : systemOverrideUnavailable(policy.detectorId);
        return Object.freeze({ candidates: [], diagnostics: [diagnostic] });
      }
      return Object.freeze({
        candidates: [{ definition: policy.definition(entrypoint), models: [] }],
        diagnostics: [unavailableModels],
      });
    },
  });
