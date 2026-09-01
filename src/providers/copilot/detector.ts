import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { nodeAcpDetector } from '../node-acp-detector.js';
import { copilotProviderPolicy } from './definition.js';

export const createCopilotDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  nodeAcpDetector(copilotProviderPolicy, options.systemExecutableOverrides?.copilot, platform);
