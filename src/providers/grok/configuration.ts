import type * as acp from '@agentclientprotocol/sdk';

import type { AgentConfigurationSelectionValue } from '../../contracts/configuration.js';
import type {
  AcpConfigurationCompatibility,
  AcpConfigurationRequester,
} from '../../protocol/acp/compatibility.js';

const maximumItems = 1_000;
const maximumStringLength = 4_096;

class GrokConfigurationMetadataError extends Error {
  constructor() {
    super('Invalid Grok configuration metadata.');
    this.name = 'GrokConfigurationMetadataError';
  }
}

const invalid = (): never => {
  throw new GrokConfigurationMetadataError();
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : invalid();

const items = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximumItems) return invalid();
  return value.map((item: unknown) => item);
};

const text = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumStringLength)
    return invalid();
  return value;
};

const optionalText = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : text(value);

interface LegacyEffort {
  readonly value: string;
  readonly name: string;
}

interface LegacyModel {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly currentEffort?: string;
  readonly efforts: readonly LegacyEffort[];
}

const effortsFrom = (metadata: Readonly<Record<string, unknown>>): readonly LegacyEffort[] => {
  const source = metadata.reasoningEfforts;
  if (source === undefined) return [];
  if (!Array.isArray(source) || source.length > maximumItems) return invalid();
  const efforts = source.map((candidate) => {
    const input = record(candidate);
    const value = text(input.value);
    return Object.freeze({ name: optionalText(input.name) ?? value, value });
  });
  if (new Set(efforts.map((effort) => effort.value)).size !== efforts.length) return invalid();
  return Object.freeze(efforts);
};

const modelFrom = (value: unknown): LegacyModel => {
  const input = record(value);
  const metadata = input['_meta'] === undefined ? {} : record(input['_meta']);
  const description = optionalText(input.description);
  const currentEffort = optionalText(metadata.reasoningEffort);
  return Object.freeze({
    ...(currentEffort === undefined ? {} : { currentEffort }),
    ...(description === undefined ? {} : { description }),
    efforts: effortsFrom(metadata),
    id: text(input.modelId),
    name: text(input.name),
  });
};

const selectedLegacyEffort = (
  sessionResponse: Readonly<Record<string, unknown>>,
): string | undefined => {
  if (sessionResponse['_meta'] === undefined) return undefined;
  const metadata = record(sessionResponse['_meta']);
  const config = metadata['x.ai/sessionConfig'];
  if (config === undefined) return undefined;
  const options = items(record(config).options);
  const selected = options.find((candidate) => {
    const option = record(candidate);
    return option.category === 'mode' && option.selected === true;
  });
  return selected === undefined ? undefined : text(record(selected).id);
};

const legacyModels = (
  sessionResponse: Readonly<Record<string, unknown>>,
): Readonly<{ readonly current: string; readonly models: readonly LegacyModel[] }> | undefined => {
  if (sessionResponse.models === undefined) return undefined;
  const source = record(sessionResponse.models);
  if (!Array.isArray(source.availableModels) || source.availableModels.length > maximumItems)
    return invalid();
  const models = Object.freeze(source.availableModels.map(modelFrom));
  if (new Set(models.map((model) => model.id)).size !== models.length) return invalid();
  return Object.freeze({ current: text(source.currentModelId), models });
};

const asAcpOptions = (
  sessionResponse: Readonly<Record<string, unknown>>,
): readonly acp.SessionConfigOption[] => {
  const state = legacyModels(sessionResponse);
  if (state === undefined) return [];
  const currentModel = state.models.find((model) => model.id === state.current);
  const currentEffort = currentModel?.currentEffort ?? selectedLegacyEffort(sessionResponse);
  const modelOption: acp.SessionConfigOption = {
    category: 'model',
    currentValue: state.current,
    id: 'model',
    name: 'Model',
    options: state.models.map((model) => ({
      _meta: { currentEffort: model.currentEffort, efforts: model.efforts },
      ...(model.description === undefined ? {} : { description: model.description }),
      name: model.name,
      value: model.id,
    })),
    type: 'select',
  };
  if (
    currentEffort === undefined ||
    currentModel === undefined ||
    currentModel.efforts.length === 0
  )
    return Object.freeze([modelOption]);
  return Object.freeze([
    modelOption,
    {
      category: 'thought_level',
      currentValue: currentEffort,
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      options: currentModel.efforts.map((effort) => ({ ...effort })),
      type: 'select',
    },
  ]);
};

const selectOption = (
  options: readonly acp.SessionConfigOption[],
  id: string,
): Extract<acp.SessionConfigOption, { readonly type: 'select' }> => {
  const option = options.find((candidate) => candidate.id === id);
  if (option?.type !== 'select') return invalid();
  return option;
};

const modelEfforts = (
  modelOption: Extract<acp.SessionConfigOption, { readonly type: 'select' }>,
  modelId: string,
): Readonly<{ readonly current?: string; readonly values: readonly LegacyEffort[] }> => {
  const candidate = modelOption.options.find(
    (option): option is acp.SessionConfigSelectOption =>
      !('group' in option) && option.value === modelId,
  );
  const metadata = candidate?.['_meta'] === undefined ? {} : record(candidate['_meta']);
  const values = metadata.efforts;
  if (!Array.isArray(values)) return Object.freeze({ values: [] });
  const efforts = Object.freeze(
    values.map((value) => {
      const effort = record(value);
      return Object.freeze({ name: text(effort.name), value: text(effort.value) });
    }),
  );
  const current = optionalText(metadata.currentEffort);
  return Object.freeze({ ...(current === undefined ? {} : { current }), values: efforts });
};

const applyLegacy = async (
  requester: AcpConfigurationRequester,
  sessionId: string,
  options: readonly acp.SessionConfigOption[],
  configId: string,
  value: AgentConfigurationSelectionValue,
): Promise<readonly acp.SessionConfigOption[]> => {
  if (typeof value !== 'string') return invalid();
  const model = selectOption(options, 'model');
  const modelId = configId === 'model' ? value : model.currentValue;
  await requester.request('session/set_model', {
    ...(configId === 'reasoning_effort' ? { _meta: { reasoningEffort: value } } : {}),
    modelId,
    sessionId,
  });
  const updatedModel = { ...model, currentValue: modelId };
  const effortState = modelEfforts(model, modelId);
  const currentEffort = configId === 'reasoning_effort' ? value : effortState.current;
  if (currentEffort === undefined || effortState.values.length === 0)
    return Object.freeze([updatedModel]);
  const reasoning: acp.SessionConfigOption = {
    category: 'thought_level',
    currentValue: currentEffort,
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    options: effortState.values.map((effort) => ({ ...effort })),
    type: 'select',
  };
  return Object.freeze([updatedModel, reasoning]);
};

export const grokConfigurationCompatibility: AcpConfigurationCompatibility = Object.freeze({
  applyLegacy,
  legacyOptions: asAcpOptions,
});
