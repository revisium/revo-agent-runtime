export const builtInProviderIds = Object.freeze([
  'antigravity',
  'claude',
  'cline',
  'codex',
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

const builtInProviderIdSet = new Set<string>(builtInProviderIds);

export const isBuiltInProviderId = (value: string): value is BuiltInProviderId =>
  builtInProviderIdSet.has(value);

type ProviderLayerExtension = 'configuration-core' | 'execution-configuration' | 'protocol-acp';

export const providerLayerExtensions: Readonly<
  Partial<Record<BuiltInProviderId, readonly ProviderLayerExtension[]>>
> = Object.freeze({
  grok: ['configuration-core', 'execution-configuration', 'protocol-acp'],
  opencode: ['protocol-acp'],
});

export const providerPathExpression = new RegExp(
  `(?:^|/)(${builtInProviderIds.join('|')})(?:/|$)`,
  'i',
);

export const providerNameExpression = new RegExp(`\\b(?:${builtInProviderIds.join('|')})\\b`, 'i');
