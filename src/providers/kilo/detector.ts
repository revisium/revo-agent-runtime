import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { nodeAcpDetector } from '../node-acp-detector.js';
import { kiloProviderPolicy } from './definition.js';

export const createKiloDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  nodeAcpDetector(kiloProviderPolicy, options.systemExecutableOverrides?.kilo, platform);
