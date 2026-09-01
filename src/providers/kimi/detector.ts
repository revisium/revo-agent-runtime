import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { nodeAcpDetector } from '../node-acp-detector.js';
import { kimiProviderPolicy } from './definition.js';

export const createKimiDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  nodeAcpDetector(kimiProviderPolicy, options.systemExecutableOverrides?.kimi, platform);
