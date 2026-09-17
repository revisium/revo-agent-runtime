import type { AgentDetector, DiscoverAgentsOptions } from '../contracts/discovery.js';
import type { DiscoveryPlatform } from '../discovery/platform.js';
import type { ConfigurationCatalogFallbackResolver } from '../execution/configuration/fallback.js';
import {
  promptPrefixDelivery,
  type InstructionsDeliveryResolver,
} from '../execution/instructions/delivery.js';
import type {
  AcpProviderCompatibility,
  AcpProviderCompatibilityResolver,
} from '../protocol/acp/compatibility.js';
import { createAntigravityDetector } from './antigravity/detector.js';
import { createClaudeDetector } from './claude/detector.js';
import { claudeInstructionsDelivery } from './claude/instructions.js';
import { createClineDetector } from './cline/detector.js';
import { createCodexDetector } from './codex/detector.js';
import { createCopilotDetector } from './copilot/detector.js';
import { createCursorDetector } from './cursor/detector.js';
import { createGeminiDetector } from './gemini/detector.js';
import { createGooseDetector } from './goose/detector.js';
import { grokConfigurationCompatibility } from './grok/configuration.js';
import { createGrokDetector } from './grok/detector.js';
import { grokModelCommandFallback } from './grok/model-command.js';
import { grokMcpPermission } from './grok/permission.js';
import { createHermesDetector } from './hermes/detector.js';
import type { ProviderHost, ProviderInstructionsDelivery } from './instructions-delivery.js';
import { createKiloDetector } from './kilo/detector.js';
import { createKimiDetector } from './kimi/detector.js';
import { openCodeConfigurationCompatibility } from './opencode/configuration.js';
import { createOpenCodeDetector } from './opencode/detector.js';
import { openCodeInstructionsDelivery } from './opencode/instructions.js';
import { createQwenDetector } from './qwen/detector.js';
import { createVibeDetector } from './vibe/detector.js';

interface ProviderRegistration {
  readonly createDetector: (
    options: DiscoverAgentsOptions,
    platform: DiscoveryPlatform,
  ) => AgentDetector;
  readonly definitionId?: string;
  readonly compatibility?: AcpProviderCompatibility;
  readonly fallback?: NonNullable<ReturnType<ConfigurationCatalogFallbackResolver>>;
  readonly instructions?: ProviderInstructionsDelivery;
}

const providerRegistrations: readonly ProviderRegistration[] = Object.freeze([
  { createDetector: createAntigravityDetector },
  { createDetector: createCodexDetector },
  {
    createDetector: createClaudeDetector,
    definitionId: 'claude-acp',
    instructions: claudeInstructionsDelivery,
  },
  { createDetector: createClineDetector },
  { createDetector: createCopilotDetector },
  { createDetector: createCursorDetector },
  { createDetector: createGeminiDetector },
  { createDetector: createGooseDetector },
  {
    createDetector: createGrokDetector,
    definitionId: 'grok-acp',
    compatibility: {
      ...grokConfigurationCompatibility,
      approveMcpPermission: grokMcpPermission,
      finalResultTurn: true,
    },
    fallback: grokModelCommandFallback,
  },
  { createDetector: createHermesDetector },
  { createDetector: createKiloDetector },
  { createDetector: createKimiDetector },
  {
    createDetector: createOpenCodeDetector,
    definitionId: 'opencode-acp',
    compatibility: openCodeConfigurationCompatibility,
    instructions: openCodeInstructionsDelivery,
  },
  { createDetector: createQwenDetector },
  { createDetector: createVibeDetector },
]);

const registrationFor = (definitionId: string): ProviderRegistration | undefined =>
  providerRegistrations.find((registration) => registration.definitionId === definitionId);

export const builtInConfigurationCompatibility: AcpProviderCompatibilityResolver = (definitionId) =>
  registrationFor(definitionId)?.compatibility;

export const builtInConfigurationFallback: ConfigurationCatalogFallbackResolver = (definitionId) =>
  registrationFor(definitionId)?.fallback;

/** Providers without a source-proven additive channel keep the first-prompt prefix. */
export const builtInInstructionsDelivery =
  (host: ProviderHost): InstructionsDeliveryResolver =>
  (request) =>
    registrationFor(request.definitionId)?.instructions?.(request, host) ?? promptPrefixDelivery;

/** The only composition registration needed for a built-in provider. */
export const builtInDetectors = (
  options: DiscoverAgentsOptions,
  platform: DiscoveryPlatform,
): readonly AgentDetector[] =>
  Object.freeze(
    providerRegistrations.map((registration) => registration.createDetector(options, platform)),
  );
