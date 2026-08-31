import type * as acp from '@agentclientprotocol/sdk';

import type { AcpConfigurationCompatibility } from '../../protocol/acp/compatibility.js';

class OpenCodeConfigurationError extends Error {
  constructor() {
    super('Invalid OpenCode configuration.');
    this.name = 'OpenCodeConfigurationError';
  }
}

const providerIdentity = (
  option: acp.SessionConfigSelectOption,
): Readonly<{ readonly id: string; readonly name: string }> => {
  const valueSeparator = option.value.indexOf('/');
  const nameSeparator = option.name.indexOf('/');
  if (valueSeparator < 1 || nameSeparator < 1) throw new OpenCodeConfigurationError();
  return Object.freeze({
    id: option.value.slice(0, valueSeparator),
    name: option.name.slice(0, nameSeparator),
  });
};

const groupModels = (
  values: readonly acp.SessionConfigSelectOption[],
): acp.SessionConfigSelectGroup[] => {
  const groups = new Map<string, acp.SessionConfigSelectGroup>();
  for (const value of values) {
    const provider = providerIdentity(value);
    const existing = groups.get(provider.id);
    if (existing === undefined)
      groups.set(provider.id, {
        group: provider.id,
        name: provider.name,
        options: [value],
      });
    else {
      if (existing.name !== provider.name) throw new OpenCodeConfigurationError();
      existing.options.push(value);
    }
  }
  return [...groups.values()];
};

const isFlatOption = (
  value: acp.SessionConfigSelectOption | acp.SessionConfigSelectGroup,
): value is acp.SessionConfigSelectOption => !('group' in value);

const decorate = (
  options: readonly acp.SessionConfigOption[],
): readonly acp.SessionConfigOption[] =>
  Object.freeze(
    options.map((option) => {
      if (option.type !== 'select' || option.category !== 'model') return option;
      if (!option.options.every(isFlatOption)) return option;
      return Object.freeze({ ...option, options: groupModels(option.options) });
    }),
  );

export const openCodeConfigurationCompatibility: AcpConfigurationCompatibility = Object.freeze({
  decorate,
});
