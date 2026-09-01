export const builtInProviderIds = Object.freeze([
  'antigravity',
  'codex',
  'claude',
  'cline',
  'copilot',
  'cursor',
  'gemini',
  'goose',
  'grok',
  'hermes',
  'kilo',
  'kimi',
  'opencode',
  'qwen',
  'vibe',
] as const);

export type BuiltInProviderId = (typeof builtInProviderIds)[number];

const isBuiltInProviderId = (value: string): value is BuiltInProviderId =>
  builtInProviderIds.some((provider) => provider === value);

const selectedProvider = (
  value: string,
  variable: 'REVO_LIVE_AGENT_SMOKE' | 'REVO_LIVE_CONFIGURATION_SMOKE',
): BuiltInProviderId => {
  if (isBuiltInProviderId(value)) return value;
  throw new Error(`${variable} must name a supported built-in ACP provider or all.`);
};

/** Historical ready set; `all` intentionally does not start every live provider. */
const acceptedAgentAllProviders = Object.freeze(['codex', 'claude', 'grok'] as const);

export const agentSmokeProviders = (value: string): readonly BuiltInProviderId[] =>
  value === 'all' ? acceptedAgentAllProviders : [selectedProvider(value, 'REVO_LIVE_AGENT_SMOKE')];

/** Configuration `all` deliberately proves the stricter every-provider boundary. */
export const configurationSmokeProviders = (value: string): readonly BuiltInProviderId[] =>
  value === 'all' ? builtInProviderIds : [selectedProvider(value, 'REVO_LIVE_CONFIGURATION_SMOKE')];
