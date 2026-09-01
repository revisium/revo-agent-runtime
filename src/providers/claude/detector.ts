import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { bundledBridgeDetector } from '../bundled-bridge-detector.js';
import { claudeProviderPolicy } from './definition.js';

export const createClaudeDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  bundledBridgeDetector(claudeProviderPolicy, options.systemExecutableOverrides?.claude, platform);
