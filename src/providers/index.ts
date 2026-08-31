import type { AgentDetector, DiscoverAgentsOptions } from '../contracts/discovery.js';
import type { DiscoveryPlatform } from '../discovery/platform.js';
import type { ConfigurationCatalogFallbackResolver } from '../execution/configuration/fallback.js';
import type { AcpConfigurationCompatibilityResolver } from '../protocol/acp/compatibility.js';
import { createAntigravityDetector } from './antigravity/detector.js';
import { createClaudeDetector } from './claude/detector.js';
import { createClineDetector } from './cline/detector.js';
import { createCodexDetector } from './codex/detector.js';
import { createCopilotDetector } from './copilot/detector.js';
import { createCursorDetector } from './cursor/detector.js';
import { createGeminiDetector } from './gemini/detector.js';
import { createGooseDetector } from './goose/detector.js';
import { grokConfigurationCompatibility } from './grok/configuration.js';
import { createGrokDetector } from './grok/detector.js';
import { grokModelCommandFallback } from './grok/model-command.js';
import { createHermesDetector } from './hermes/detector.js';
import { createKiloDetector } from './kilo/detector.js';
import { createKimiDetector } from './kimi/detector.js';
import { openCodeConfigurationCompatibility } from './opencode/configuration.js';
import { createOpenCodeDetector } from './opencode/detector.js';
import { createQwenDetector } from './qwen/detector.js';
import { createVibeDetector } from './vibe/detector.js';

interface ProviderRegistration {
  readonly createDetector: (
    options: DiscoverAgentsOptions,
    platform: DiscoveryPlatform,
  ) => AgentDetector;
  readonly definitionId?: string;
  readonly compatibility?: NonNullable<ReturnType<AcpConfigurationCompatibilityResolver>>;
  readonly fallback?: NonNullable<ReturnType<ConfigurationCatalogFallbackResolver>>;
}

const providerRegistrations: readonly ProviderRegistration[] = Object.freeze([
  { createDetector: createAntigravityDetector },
  { createDetector: createCodexDetector },
  { createDetector: createClaudeDetector },
  { createDetector: createClineDetector },
  { createDetector: createCopilotDetector },
  { createDetector: createCursorDetector },
  { createDetector: createGeminiDetector },
  { createDetector: createGooseDetector },
  {
    createDetector: createGrokDetector,
    definitionId: 'grok-acp',
    compatibility: grokConfigurationCompatibility,
    fallback: grokModelCommandFallback,
  },
  { createDetector: createHermesDetector },
  { createDetector: createKiloDetector },
  { createDetector: createKimiDetector },
  {
    createDetector: createOpenCodeDetector,
    definitionId: 'opencode-acp',
    compatibility: openCodeConfigurationCompatibility,
  },
  { createDetector: createQwenDetector },
  { createDetector: createVibeDetector },
]);

export const builtInConfigurationCompatibility: AcpConfigurationCompatibilityResolver = (
  definitionId,
) =>
  providerRegistrations.find((registration) => registration.definitionId === definitionId)
    ?.compatibility;

export const builtInConfigurationFallback: ConfigurationCatalogFallbackResolver = (definitionId) =>
  providerRegistrations.find((registration) => registration.definitionId === definitionId)
    ?.fallback;

/** The only composition registration needed for a built-in provider. */
export const builtInDetectors = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): readonly AgentDetector[] =>
  Object.freeze(
    providerRegistrations.map((registration) => registration.createDetector(options, platform)),
  );
