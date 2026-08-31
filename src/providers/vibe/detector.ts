import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemAcpDetector } from '../system-acp-detector.js';
import { vibeProviderPolicy } from './definition.js';

export const createVibeDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  systemAcpDetector(vibeProviderPolicy, options.systemExecutableOverrides?.vibe, platform);
