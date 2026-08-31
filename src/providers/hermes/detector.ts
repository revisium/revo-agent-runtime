import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemAcpDetector } from '../system-acp-detector.js';
import { hermesProviderPolicy } from './definition.js';

export const createHermesDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  systemAcpDetector(hermesProviderPolicy, options.systemExecutableOverrides?.hermes, platform);
