import { expect, test } from 'vitest';

import { normalizeAcpConfiguration } from '../../../../src/configuration/catalog.js';
import { openCodeConfigurationCompatibility } from '../../../../src/providers/opencode/configuration.js';

test('preserves OpenCode session-available provider groups from its stable flat model ids', () => {
  const decorated = openCodeConfigurationCompatibility.decorate?.([
    {
      category: 'model',
      currentValue: 'opencode/big-pickle',
      id: 'model',
      name: 'Model',
      options: [
        { name: 'OpenRouter/Claude', value: 'openrouter/anthropic/claude' },
        { name: 'OpenRouter/Grok', value: 'openrouter/xai/grok' },
        { name: 'OpenCode/Big Pickle', value: 'opencode/big-pickle' },
        { name: 'xAI/Grok 4.6', value: 'xai/grok-4.6' },
      ],
      type: 'select',
    },
  ]);
  const catalog = normalizeAcpConfiguration(decorated ?? []);

  expect(catalog.model).toMatchObject({
    currentModel: 'opencode/big-pickle',
    currentProvider: { id: 'opencode', name: 'OpenCode' },
    providers: [
      {
        id: 'openrouter',
        models: [{ value: 'openrouter/anthropic/claude' }, { value: 'openrouter/xai/grok' }],
      },
      { id: 'opencode', models: [{ value: 'opencode/big-pickle' }] },
      { id: 'xai', models: [{ value: 'xai/grok-4.6' }] },
    ],
  });
});

test('preserves non-model and already-grouped stable options', () => {
  const grouped = {
    category: 'model',
    currentValue: 'x/one',
    id: 'model',
    name: 'Model',
    options: [{ group: 'x', name: 'Provider X', options: [{ name: 'One', value: 'x/one' }] }],
    type: 'select' as const,
  };
  const boolean = { currentValue: true, id: 'fast', name: 'Fast', type: 'boolean' as const };

  expect(openCodeConfigurationCompatibility.decorate?.([grouped, boolean])).toEqual([
    grouped,
    boolean,
  ]);
});

test('rejects conflicting OpenCode provider names for the same provider id', () => {
  expect(() =>
    openCodeConfigurationCompatibility.decorate?.([
      {
        category: 'model',
        currentValue: 'same/one',
        id: 'model',
        name: 'Model',
        options: [
          { name: 'First/One', value: 'same/one' },
          { name: 'Second/Two', value: 'same/two' },
        ],
        type: 'select',
      },
    ]),
  ).toThrow('OpenCode configuration');
});

test('rejects an OpenCode model value without an explicit provider prefix', () => {
  expect(() =>
    openCodeConfigurationCompatibility.decorate?.([
      {
        category: 'model',
        currentValue: 'unqualified',
        id: 'model',
        name: 'Model',
        options: [{ name: 'Unknown', value: 'unqualified' }],
        type: 'select',
      },
    ]),
  ).toThrow('OpenCode configuration');
});
