import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { nodeAcpDetector } from '../node-acp-detector.js';
import { qwenProviderPolicy } from './definition.js';

export const createQwenDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  nodeAcpDetector(qwenProviderPolicy, options.systemExecutableOverrides?.qwen, platform);
