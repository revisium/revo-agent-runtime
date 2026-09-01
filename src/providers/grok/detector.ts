import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemAcpDetector } from '../system-acp-detector.js';
import { grokProviderPolicy } from './definition.js';

export const createGrokDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  systemAcpDetector(grokProviderPolicy, options.systemExecutableOverrides?.grok, platform);
