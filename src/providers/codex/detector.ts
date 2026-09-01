import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { bundledBridgeDetector } from '../bundled-bridge-detector.js';
import { codexProviderPolicy } from './definition.js';

export const createCodexDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  bundledBridgeDetector(codexProviderPolicy, options.systemExecutableOverrides?.codex, platform);
