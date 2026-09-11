import { expect, test } from 'vitest';

import { parseOpenCodeProviderCatalog } from '../../../../src/providers/opencode/catalog.js';

test('maps the native all catalog and explicit connected provider ids', () => {
  const providers = parseOpenCodeProviderCatalog({
    all: [
      {
        id: 'openrouter',
        models: {
          'anthropic/claude': { name: 'Claude' },
          'xai/grok': { name: 'Grok', key: 'must-not-escape' },
        },
        name: 'OpenRouter',
      },
      { id: 'opencode', models: { 'big-pickle': { name: 'Big Pickle' } }, name: 'OpenCode' },
    ],
    connected: ['openrouter'],
    default: { openrouter: 'anthropic/claude' },
  });

  expect(providers).toEqual([
    {
      connected: true,
      id: 'openrouter',
      models: [
        { connected: true, value: 'openrouter/anthropic/claude', name: 'Claude' },
        { connected: true, value: 'openrouter/xai/grok', name: 'Grok' },
      ],
      name: 'OpenRouter',
    },
    {
      connected: false,
      id: 'opencode',
      models: [{ connected: false, value: 'opencode/big-pickle', name: 'Big Pickle' }],
      name: 'OpenCode',
    },
  ]);
  expect(Object.isFrozen(providers[0])).toBe(true);
  expect(Object.isFrozen(providers[0]?.models[0])).toBe(true);
});

test('rejects a response without a full provider catalog', () => {
  expect(() => parseOpenCodeProviderCatalog({ all: [], connected: [] })).toThrow(
    'provider catalog is empty',
  );
});

test.each([
  ['not an object', null],
  ['invalid all catalog', { all: {}, connected: [] }],
  ['invalid provider entry', { all: [null], connected: [] }],
  ['missing connected', { all: [] }],
  ['invalid connected id', { all: [], connected: [''] }],
  ['missing model map', { all: [{ id: 'provider' }], connected: [] }],
  ['invalid provider entries', { all: [{}], connected: [] }],
])('rejects %s', (_name, value) => {
  expect(() => parseOpenCodeProviderCatalog(value)).toThrow('OpenCode');
});

test('accepts native models without metadata', () => {
  expect(
    parseOpenCodeProviderCatalog({ all: [{ id: 'p', models: { m: 'plain' } }], connected: [] }),
  ).toEqual([
    {
      connected: false,
      id: 'p',
      models: [{ connected: false, value: 'p/m', name: 'm' }],
      name: 'p',
    },
  ]);
});
