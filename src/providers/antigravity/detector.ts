import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemAcpDetector } from '../system-acp-detector.js';
import { antigravityProviderPolicy } from './definition.js';

export const createAntigravityDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  systemAcpDetector(
    antigravityProviderPolicy,
    options.systemExecutableOverrides?.antigravity,
    platform,
  );
