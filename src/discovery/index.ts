import type {
  AgentDetector,
  AgentDiscoveryResult,
  DiscoverAgentsOptions,
} from '../contracts/discovery.js';
import { nodeDiscoveryPlatform } from '../platform/node/discovery/platform.js';
import { builtInDetectors } from '../providers/index.js';
import { runDetectors } from './runner.js';

export const discoverAgents = async (
  options: DiscoverAgentsOptions = {},
): Promise<AgentDiscoveryResult> => {
  const detectors: AgentDetector[] = [
    ...(options.includeBuiltInDetectors === false
      ? []
      : builtInDetectors(options, nodeDiscoveryPlatform)),
    ...(options.detectors ?? []),
  ];
  return runDetectors(detectors, options);
};
