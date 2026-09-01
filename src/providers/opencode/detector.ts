import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemAcpDetector } from '../system-acp-detector.js';
import { openCodeProviderPolicy } from './definition.js';

export const createOpenCodeDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  systemAcpDetector(openCodeProviderPolicy, options.systemExecutableOverrides?.opencode, platform);
