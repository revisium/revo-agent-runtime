import { expect, test } from 'vitest';

import { normalizeAcpConfiguration } from '../../../../src/configuration/catalog.js';

test('normalizes grouped, flat, boolean, and unknown-category ACP options without flattening groups', () => {
  const catalog = normalizeAcpConfiguration([
    {
      category: 'model',
      currentValue: 'x/one',
      id: 'model',
      name: 'Model',
      options: [
        {
          group: 'x',
          name: 'Provider X',
          options: [{ name: 'One', value: 'x/one' }],
        },
        {
          group: 'y',
          name: 'Provider Y',
          options: [{ description: 'Second model', name: 'Two', value: 'y/two' }],
        },
      ],
      type: 'select',
    },
    {
      category: '_vendor_safe',
      currentValue: 'a',
      id: 'custom',
      name: 'Custom',
      options: [{ name: 'A', value: 'a' }],
      type: 'select',
    },
    { currentValue: true, id: 'fast', name: 'Fast', type: 'boolean' },
  ]);

  expect(catalog.model).toEqual({
    currentModel: 'x/one',
    currentProvider: { id: 'x', name: 'Provider X' },
    optionId: 'model',
    providers: [
      {
        id: 'x',
        models: [{ group: { id: 'x', name: 'Provider X' }, name: 'One', value: 'x/one' }],
        name: 'Provider X',
      },
      {
        id: 'y',
        models: [
          {
            description: 'Second model',
            group: { id: 'y', name: 'Provider Y' },
            name: 'Two',
            value: 'y/two',
          },
        ],
        name: 'Provider Y',
      },
    ],
    sessionAvailable: catalog.options[0]?.type === 'select' ? catalog.options[0].values : [],
  });
  expect(catalog.catalogRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.isFrozen(catalog.options)).toBe(true);
});

test('rejects duplicate ids and oversized catalogs instead of guessing', () => {
  const option = {
    currentValue: 'a',
    id: 'model',
    name: 'Model',
    options: [{ name: 'A', value: 'a' }],
    type: 'select' as const,
  };
  expect(() => normalizeAcpConfiguration([option, option])).toThrow('configuration catalog');
  expect(() => normalizeAcpConfiguration([{ ...option, name: 'x'.repeat(4_097) }])).toThrow(
    'configuration catalog',
  );
  expect(() => normalizeAcpConfiguration(Array.from({ length: 1_001 }, () => option))).toThrow(
    'configuration catalog',
  );
  expect(() =>
    normalizeAcpConfiguration([
      {
        ...option,
        options: Array.from({ length: 5_001 }, (_, index) => ({
          name: `Value ${index}`,
          value: `value-${index}`,
        })),
      },
    ]),
  ).toThrow('configuration catalog');
  expect(() =>
    normalizeAcpConfiguration([
      {
        ...option,
        options: [{ name: 'A', value: 'x'.repeat(4_097) }],
      },
    ]),
  ).toThrow('configuration catalog');
  expect(() =>
    normalizeAcpConfiguration([
      {
        ...option,
        options: [
          { name: 'A', value: 'a' },
          { name: 'Again', value: 'a' },
        ],
      },
    ]),
  ).toThrow('configuration catalog');
});

test('rejects conflicting provider groups and catalogs beyond the publication byte budget', () => {
  expect(() =>
    normalizeAcpConfiguration([
      {
        category: 'model',
        currentValue: 'one',
        id: 'model',
        name: 'Model',
        options: [
          { group: 'same', name: 'First', options: [{ name: 'One', value: 'one' }] },
          { group: 'same', name: 'Second', options: [{ name: 'Two', value: 'two' }] },
        ],
        type: 'select',
      },
    ]),
  ).toThrow('configuration catalog');
  expect(() =>
    normalizeAcpConfiguration(
      Array.from({ length: 300 }, (_, index) => ({
        currentValue: `value-${index}`,
        id: `option-${index}`,
        name: 'x'.repeat(4_000),
        options: [{ name: 'Value', value: `value-${index}` }],
        type: 'select' as const,
      })),
    ),
  ).toThrow('configuration catalog');
});

test('handles an empty catalog and wraps unexpected malformed runtime values', () => {
  expect(normalizeAcpConfiguration([])).not.toHaveProperty('model');
  expect(() => {
    Reflect.apply(normalizeAcpConfiguration, undefined, [null]);
  }).toThrow('configuration catalog');
});

test('normalizes nullable ACP descriptions and exposes a present option description', () => {
  const catalog = normalizeAcpConfiguration([
    {
      category: null,
      currentValue: false,
      description: null,
      id: 'plain',
      name: 'Plain',
      type: 'boolean',
    },
    {
      currentValue: true,
      description: 'Visible description',
      id: 'described',
      name: 'Described',
      type: 'boolean',
    },
  ]);

  expect(catalog.options).toEqual([
    { currentValue: false, id: 'plain', name: 'Plain', type: 'boolean' },
    {
      currentValue: true,
      description: 'Visible description',
      id: 'described',
      name: 'Described',
      type: 'boolean',
    },
  ]);
});

test('preserves ACP default select identifiers, including an empty default value', () => {
  const catalog = normalizeAcpConfiguration([
    {
      category: '_agent',
      currentValue: '',
      id: 'agent',
      name: 'Agent',
      options: [
        { description: 'Default Copilot agent', name: 'Copilot', value: '' },
        { name: 'Code reviewer', value: 'code-reviewer' },
      ],
      type: 'select',
    },
  ]);

  expect(catalog.options).toEqual([
    {
      category: '_agent',
      currentValue: '',
      id: 'agent',
      name: 'Agent',
      type: 'select',
      values: [
        { description: 'Default Copilot agent', name: 'Copilot', value: '' },
        { name: 'Code reviewer', value: 'code-reviewer' },
      ],
    },
  ]);
});

test('preserves a bridge-reported select current value that is outside its picker', () => {
  const catalog = normalizeAcpConfiguration([
    {
      currentValue: 'bridge-current',
      id: 'model',
      name: 'Model',
      options: [{ name: 'Picker value', value: 'picker-value' }],
      type: 'select',
    },
  ]);

  expect(catalog.options).toEqual([
    {
      currentValue: 'bridge-current',
      id: 'model',
      name: 'Model',
      type: 'select',
      values: [{ name: 'Picker value', value: 'picker-value' }],
    },
  ]);
});
