import type { AgentDetector, DiscoverAgentsOptions } from '../../contracts/discovery.js';
import type { DiscoveryPlatform } from '../../discovery/platform.js';
import { systemAcpDetector } from '../system-acp-detector.js';
import { geminiProviderPolicy } from './definition.js';

export const createGeminiDetector = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): AgentDetector =>
  systemAcpDetector(geminiProviderPolicy, options.systemExecutableOverrides?.gemini, platform);
