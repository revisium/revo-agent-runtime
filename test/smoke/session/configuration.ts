import type { AgentConfigurationCatalog, AgentConfigurationSelection } from '../../../src/index.js';

const selectedValue = (
  option: AgentConfigurationCatalog['options'][number],
  preferredModel: string | undefined,
): boolean | string => {
  if (option.type === 'boolean') return option.currentValue;
  if (option.category === 'model' && preferredModel !== undefined) {
    if (!option.values.some(({ value }) => value === preferredModel))
      throw new Error('Requested smoke model is unavailable.');
    return preferredModel;
  }
  if (option.category === 'thought_level')
    return option.values.find(({ value }) => value === 'low')?.value ?? option.currentValue;
  return option.currentValue;
};

export const configurationForSessionSmoke = (
  catalog: AgentConfigurationCatalog,
  preferredModel?: string,
): AgentConfigurationSelection => ({
  catalogRevision: catalog.catalogRevision,
  selections: Object.fromEntries(
    catalog.options.map((option) => [option.id, selectedValue(option, preferredModel)]),
  ),
});

export const preferredModelForSessionSmoke = (providerId: string): string | undefined => {
  if (providerId === 'codex-acp') return 'gpt-5.6-luna';
  if (providerId === 'claude-acp') return 'sonnet';
  if (providerId === 'opencode-acp') return 'xai/grok-4.20-0309-non-reasoning';
  return undefined;
};
