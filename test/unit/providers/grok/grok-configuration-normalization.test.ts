import type {} from '@agentclientprotocol/sdk';
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
test('normalizes Grok legacy models and reasoning metadata into stable ACP option shapes', () => {
  const options = grokConfigurationCompatibility.legacyOptions?.({
    _meta: {
      'x.ai/sessionConfig': {
        options: [
          { category: 'model', id: 'grok-4.6', label: 'Grok 4.6', selected: true },
          { category: 'mode', id: 'medium', label: 'Medium', selected: true },
        ],
      },
    },
    models: {
      availableModels: [
        {
          _meta: {
            reasoningEfforts: [
              { name: 'Low', value: 'low' },
              { name: 'Medium', value: 'medium' },
              { name: 'High', value: 'high' },
              { name: 'Extra high', value: 'xhigh' },
            ],
          },
          description: 'Latest Grok model',
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
        },
        {
          _meta: {
            reasoningEfforts: [
              { name: 'Low', value: 'low' },
              { name: 'High', value: 'high' },
            ],
          },
          modelId: 'grok-4.5',
          name: 'Grok 4.5',
        },
      ],
      currentModelId: 'grok-4.6',
    },
    sessionId: 'fixture',
  });

  expect(options).toMatchObject([
    {
      category: 'model',
      currentValue: 'grok-4.6',
      id: 'model',
      name: 'Model',
      options: [
        { description: 'Latest Grok model', name: 'Grok 4.6', value: 'grok-4.6' },
        { name: 'Grok 4.5', value: 'grok-4.5' },
      ],
      type: 'select',
    },
    {
      category: 'thought_level',
      currentValue: 'medium',
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      options: [
        { name: 'Low', value: 'low' },
        { name: 'Medium', value: 'medium' },
        { name: 'High', value: 'high' },
        { name: 'Extra high', value: 'xhigh' },
      ],
      type: 'select',
    },
  ]);
});

test('returns no legacy options when Grok session metadata is absent', () => {
  expect(grokConfigurationCompatibility.legacyOptions?.({ sessionId: 'fixture' })).toEqual([]);
});

test.each([
  {
    models: {
      availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }],
      currentModelId: 'grok-4.6',
    },
  },
  {
    _meta: {},
    models: {
      availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }],
      currentModelId: 'grok-4.6',
    },
  },
  {
    _meta: { 'x.ai/sessionConfig': { options: [{ category: 'mode', id: 'high' }] } },
    models: {
      availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }],
      currentModelId: 'grok-4.6',
    },
  },
  {
    models: {
      availableModels: [{ modelId: 'grok-4.5', name: 'Grok 4.5' }],
      currentModelId: 'grok-4.6',
    },
  },
] as const)(
  'publishes only known model choices when reasoning state is unavailable %#',
  (value) => {
    expect(grokConfigurationCompatibility.legacyOptions?.(value)).toMatchObject([
      { id: 'model', type: 'select' },
    ]);
  },
);

test('rejects malformed Grok legacy metadata rather than publishing partial choices', () => {
  expect(() =>
    grokConfigurationCompatibility.legacyOptions?.({
      models: { availableModels: [{ modelId: 42 }], currentModelId: 'grok-4.6' },
    }),
  ).toThrow('Grok configuration metadata');
});

test('applies Grok model and reasoning selections through its legacy method before a prompt', async () => {
  const requests: unknown[] = [];
  const context = requester((method, params) => requests.push({ method, params }));
  const options = grokConfigurationCompatibility.legacyOptions?.({
    models: {
      availableModels: [
        {
          _meta: {
            reasoningEffort: 'medium',
            reasoningEfforts: [
              { name: 'Medium', value: 'medium' },
              { name: 'High', value: 'high' },
            ],
          },
          modelId: 'grok-4.6',
          name: 'Grok 4.6',
        },
        {
          _meta: {
            reasoningEffort: 'high',
            reasoningEfforts: [
              { name: 'Low', value: 'low' },
              { name: 'High', value: 'high' },
            ],
          },
          modelId: 'grok-4.5',
          name: 'Grok 4.5',
        },
      ],
      currentModelId: 'grok-4.6',
    },
  });
  const apply = grokConfigurationCompatibility.applyLegacy;
  if (options === undefined || apply === undefined)
    throw new Error('Expected Grok compatibility ports.');

  const switched = await apply(context, 'session', options, 'model', 'grok-4.5');
  const reasoned = await apply(context, 'session', switched, 'reasoning_effort', 'low');

  expect(requests).toEqual([
    { method: 'session/set_model', params: { modelId: 'grok-4.5', sessionId: 'session' } },
    {
      method: 'session/set_model',
      params: {
        _meta: { reasoningEffort: 'low' },
        modelId: 'grok-4.5',
        sessionId: 'session',
      },
    },
  ]);
  expect(reasoned).toMatchObject([
    { currentValue: 'grok-4.5', id: 'model' },
    { currentValue: 'low', id: 'reasoning_effort' },
  ]);
});
