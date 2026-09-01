import { expect, test } from 'vitest';

import { grokModelCommandFallback } from '../../../../src/providers/grok/model-command.js';

test('normalizes the bounded grok models command as a model-only fallback catalog', () => {
  const catalog = grokModelCommandFallback.parse(
    new TextEncoder().encode(
      'You are logged in with grok.com.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n',
    ),
  );

  expect(catalog).toMatchObject({
    model: {
      currentModel: 'grok-4.6',
      sessionAvailable: [{ value: 'grok-4.6' }, { value: 'grok-4.5' }],
    },
    options: [{ currentValue: 'grok-4.6', id: 'model', type: 'select' }],
  });
});

test('rejects ambiguous or malformed grok models output', () => {
  expect(() => grokModelCommandFallback.parse(new TextEncoder().encode('no models\n'))).toThrow(
    'grok models output',
  );
  expect(() =>
    grokModelCommandFallback.parse(
      new TextEncoder().encode('Default model: missing\nAvailable models:\n  - grok-4.6\n'),
    ),
  ).toThrow('grok models output');
  expect(() => grokModelCommandFallback.parse(Uint8Array.from([0xff]))).toThrow(
    'grok models output',
  );
});
