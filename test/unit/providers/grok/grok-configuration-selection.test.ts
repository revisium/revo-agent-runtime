import type { SessionConfigSelectOption } from '@agentclientprotocol/sdk';
import { expect, test } from 'vitest';

import type { AcpConfigurationRequester } from '../../../../src/protocol/acp/compatibility.js';
import { grokConfigurationCompatibility } from '../../../../src/providers/grok/configuration.js';

const requester = (
  observe: (method: string, params: Readonly<Record<string, unknown>>) => void = () => undefined,
): AcpConfigurationRequester => ({
  request: async (method, params) => {
    observe(method, params);
    return {};
  },
  setOption: async () => [],
});
test('rejects impossible Grok legacy apply inputs at the provider boundary', async () => {
  const apply = grokConfigurationCompatibility.applyLegacy;
  if (apply === undefined) throw new Error('Expected Grok apply port.');
  const context = requester();

  await expect(apply(context, 'session', [], 'model', 'grok-4.6')).rejects.toThrow(
    'Grok configuration metadata',
  );
  await expect(
    apply(
      context,
      'session',
      [{ currentValue: true, id: 'model', name: 'Model', type: 'boolean' }],
      'model',
      true,
    ),
  ).rejects.toThrow('Grok configuration metadata');
});

const choicesWithoutReasoning: readonly {
  readonly values: SessionConfigSelectOption[];
}[] = [
  { values: [{ name: 'Grok 4.6', value: 'grok-4.6' }] },
  { values: [{ _meta: {}, name: 'Grok 4.6', value: 'grok-4.6' }] },
  {
    values: [
      {
        _meta: { efforts: [{ name: 'High', value: 'high' }] },
        name: 'Grok 4.6',
        value: 'grok-4.6',
      },
    ],
  },
  {
    values: [
      {
        _meta: { currentEffort: 'high', efforts: [] },
        name: 'Grok 4.6',
        value: 'grok-4.6',
      },
    ],
  },
];

test.each(choicesWithoutReasoning)(
  'keeps a legacy model selection usable without invented reasoning state %#',
  async ({ values }) => {
    const apply = grokConfigurationCompatibility.applyLegacy;
    if (apply === undefined) throw new Error('Expected Grok apply port.');
    const model = {
      currentValue: 'grok-4.6',
      id: 'model',
      name: 'Model',
      options: values,
      type: 'select' as const,
    };

    await expect(
      apply(requester(), 'session', [model], 'model', 'grok-4.6'),
    ).resolves.toMatchObject([{ currentValue: 'grok-4.6', id: 'model' }]);
  },
);

test.each([
  { models: null },
  { models: { availableModels: null, currentModelId: 'grok-4.6' } },
  {
    models: {
      availableModels: [
        { modelId: 'same', name: 'One' },
        { modelId: 'same', name: 'Two' },
      ],
      currentModelId: 'same',
    },
  },
  {
    models: {
      availableModels: [{ _meta: 1, modelId: 'grok-4.6', name: 'Grok' }],
      currentModelId: 'grok-4.6',
    },
  },
  {
    models: {
      availableModels: [{ _meta: { reasoningEfforts: 'high' }, modelId: 'grok-4.6', name: 'Grok' }],
      currentModelId: 'grok-4.6',
    },
  },
  {
    models: {
      availableModels: [
        {
          _meta: {
            reasoningEfforts: [{ value: 'high' }, { name: 'Again', value: 'high' }],
          },
          modelId: 'grok-4.6',
          name: 'Grok',
        },
      ],
      currentModelId: 'grok-4.6',
    },
  },
  {
    _meta: { 'x.ai/sessionConfig': { options: 'invalid' } },
    models: {
      availableModels: [{ modelId: 'grok-4.6', name: 'Grok' }],
      currentModelId: 'grok-4.6',
    },
  },
] as const)('rejects malformed Grok metadata case %#', (value) => {
  expect(() => grokConfigurationCompatibility.legacyOptions?.(value)).toThrow(
    'Grok configuration metadata',
  );
});
