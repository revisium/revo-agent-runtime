import { createHash } from 'node:crypto';

import type { SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';

import type {
  AgentConfigurationModelView,
  AgentConfigurationOption,
  AgentConfigurationSelectOption,
  AgentConfigurationValue,
} from '../contracts/configuration.js';
import { canonicalizeJsonBytes } from '../definition/canonical-json.js';

const maximumCatalogBytes = 1_048_576;
const maximumOptions = 1_000;
const maximumValues = 5_000;
const maximumStringLength = 4_096;

class ConfigurationCatalogError extends Error {
  constructor() {
    super('Invalid agent configuration catalog.');
    this.name = 'ConfigurationCatalogError';
  }
}

const invalidCatalog = (): never => {
  throw new ConfigurationCatalogError();
};

const bounded = (value: string): string => {
  if (value.length === 0 || value.length > maximumStringLength) return invalidCatalog();
  return value;
};

const boundedSelectValueId = (value: string): string => {
  if (value.length > maximumStringLength) return invalidCatalog();
  return value;
};

const optionalText = (value: string | null | undefined): string | undefined =>
  value == null ? undefined : bounded(value);

const valueFrom = (
  option: SessionConfigSelectOption,
  group?: { readonly id: string; readonly name: string },
): AgentConfigurationValue =>
  Object.freeze({
    ...(option.description == null ? {} : { description: bounded(option.description) }),
    ...(group === undefined ? {} : { group }),
    name: bounded(option.name),
    value: boundedSelectValueId(option.value),
  });

const selectValues = (option: Extract<SessionConfigOption, { readonly type: 'select' }>) => {
  const values: AgentConfigurationValue[] = [];
  for (const candidate of option.options) {
    if ('group' in candidate) {
      const group = Object.freeze({ id: bounded(candidate.group), name: bounded(candidate.name) });
      for (const grouped of candidate.options) values.push(valueFrom(grouped, group));
    } else values.push(valueFrom(candidate));
    if (values.length > maximumValues) return invalidCatalog();
  }
  const ids = new Set(values.map((value) => value.value));
  if (ids.size !== values.length) return invalidCatalog();
  return Object.freeze(values);
};

const normalizeOption = (option: SessionConfigOption): AgentConfigurationOption => {
  const description = optionalText(option.description);
  const common = {
    ...(option.category == null ? {} : { category: bounded(option.category) }),
    ...(description === undefined ? {} : { description }),
    id: bounded(option.id),
    name: bounded(option.name),
  };
  if (option.type === 'boolean')
    return Object.freeze({
      ...common,
      currentValue: option.currentValue,
      type: 'boolean' as const,
    });
  const values = selectValues(option);
  const currentValue = boundedSelectValueId(option.currentValue);
  return Object.freeze({ ...common, currentValue, type: 'select' as const, values });
};

const providerGroups = (model: AgentConfigurationSelectOption) => {
  const providers = new Map<
    string,
    { readonly id: string; readonly name: string; readonly models: AgentConfigurationValue[] }
  >();
  for (const value of model.values) {
    if (value.group === undefined) continue;
    const existing = providers.get(value.group.id);
    if (existing === undefined)
      providers.set(value.group.id, {
        id: value.group.id,
        models: [value],
        name: value.group.name,
      });
    else {
      if (existing.name !== value.group.name) return invalidCatalog();
      existing.models.push(value);
    }
  }
  return Object.freeze(
    [...providers.values()].map((provider) =>
      Object.freeze({ ...provider, models: Object.freeze(provider.models) }),
    ),
  );
};

const modelView = (
  options: readonly AgentConfigurationOption[],
): AgentConfigurationModelView | undefined => {
  const model = options.find(
    (option): option is AgentConfigurationSelectOption =>
      option.type === 'select' && option.category === 'model',
  );
  if (model === undefined) return undefined;
  const current = model.values.find((value) => value.value === model.currentValue);
  return Object.freeze({
    currentModel: model.currentValue,
    ...(current?.group === undefined ? {} : { currentProvider: current.group }),
    optionId: model.id,
    providers: providerGroups(model),
    sessionAvailable: model.values,
  });
};

export interface NormalizedAcpConfiguration {
  readonly catalogRevision: string;
  readonly options: readonly AgentConfigurationOption[];
  readonly model?: AgentConfigurationModelView;
}

export const normalizeAcpConfiguration = (
  source: readonly SessionConfigOption[],
): NormalizedAcpConfiguration => {
  try {
    if (source.length > maximumOptions) return invalidCatalog();
    const options = Object.freeze(source.map(normalizeOption));
    if (new Set(options.map((option) => option.id)).size !== options.length)
      return invalidCatalog();
    const bytes = canonicalizeJsonBytes(options);
    if (bytes.byteLength > maximumCatalogBytes) return invalidCatalog();
    const model = modelView(options);
    return Object.freeze({
      catalogRevision: createHash('sha256').update(bytes).digest('hex'),
      ...(model === undefined ? {} : { model }),
      options,
    });
  } catch (error) {
    if (error instanceof ConfigurationCatalogError) throw error;
    return invalidCatalog();
  }
};
