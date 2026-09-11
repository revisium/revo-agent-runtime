import { expect, test } from 'vitest';

import { snapshotConfigurationInspection } from '../../../../src/application/configuration/request.js';
import { decodeAgentConfigurationSelection } from '../../../../src/configuration/selection.js';

const inspection = () => ({
  agent: { id: 'codex', version: '1.0.0' },
  workspace: { directory: '/workspace' },
});

test('snapshots exact configuration inspection', () => {
  expect(snapshotConfigurationInspection(inspection())).toEqual(inspection());
});

test('decodes valid configuration selection inputs', () => {
  expect(decodeAgentConfigurationSelection({ selections: { fast: false, model: 'one' } })).toEqual({
    selections: { fast: false, model: 'one' },
  });
  expect(
    decodeAgentConfigurationSelection({ catalogRevision: 'revision', selections: {} }),
  ).toEqual({
    catalogRevision: 'revision',
    selections: {},
  });
  expect(decodeAgentConfigurationSelection({ selections: { agent: '' } })).toEqual({
    selections: { agent: '' },
  });
});

test.each([
  null,
  [],
  new Date(),
  { ...inspection(), extra: true },
  { agent: inspection().agent },
  { ...inspection(), [Symbol('extra')]: true },
  { ...inspection(), agent: { id: '', version: '1.0.0' } },
  { ...inspection(), agent: { id: 'codex', version: 1 } },
  { ...inspection(), workspace: { directory: '' } },
  { ...inspection(), workspace: { directory: '/workspace', extra: true } },
])('rejects malformed inspection input %#', (value) => {
  expect(() => snapshotConfigurationInspection(value)).toThrow();
});

test('rejects accessor-bearing inspection input without evaluating it', () => {
  let accessed = false;
  const value = Object.defineProperty(inspection(), 'workspace', {
    enumerable: true,
    get: () => {
      accessed = true;
      return { directory: '/workspace' };
    },
  });

  expect(() => snapshotConfigurationInspection(value)).toThrow();
  expect(accessed).toBe(false);
});

test.each([
  null,
  [],
  { selections: null },
  { selections: {}, extra: true },
  { selections: { model: 42 } },
  { selections: { model: 'x'.repeat(4_097) } },
  { selections: { model: '\ud800' } },
  { selections: { '': 'value' } },
  { selections: { '\ud800': 'value' } },
  { selections: { ['x'.repeat(257)]: 'value' } },
  { selections: { [Symbol('model')]: 'value' } },
  { selections: {}, catalogRevision: '' },
  { selections: {}, catalogRevision: 'x'.repeat(129) },
  { selections: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [index, 'value'])) },
])('rejects malformed selection input %#', (value) => {
  expect(() => decodeAgentConfigurationSelection(value)).toThrow(TypeError);
});

test('rejects accessor-bearing selection data without evaluating it', () => {
  let accessed = false;
  const selections = Object.defineProperty({}, 'model', {
    enumerable: true,
    get: () => {
      accessed = true;
      return 'model';
    },
  });

  expect(() => decodeAgentConfigurationSelection({ selections })).toThrow(TypeError);
  expect(accessed).toBe(false);
});

test('enforces UTF-8 byte limits and owns an immutable copy', () => {
  const input = {
    catalogRevision: 'тест',
    selections: { model: 'модель', empty: '', emoji: '😀' },
  };
  const decoded = decodeAgentConfigurationSelection(input);
  input.selections.model = 'changed';

  expect(decoded.selections.model).toBe('модель');
  expect(Object.isFrozen(decoded)).toBe(true);
  expect(Object.isFrozen(decoded.selections)).toBe(true);
  expect(() =>
    decodeAgentConfigurationSelection({ selections: { ['я'.repeat(129)]: 'value' } }),
  ).toThrow(TypeError);
  expect(() =>
    decodeAgentConfigurationSelection({ selections: { model: 'я'.repeat(2_049) } }),
  ).toThrow(TypeError);
});

test.each([
  { selections: {}, catalogRevision: undefined },
  { selections: Object.create({ inherited: true }) },
])('rejects invalid selection container shape %#', (value) => {
  expect(() => decodeAgentConfigurationSelection(value)).toThrow(TypeError);
});

test('accepts null-prototype records and preserves special selection keys', () => {
  const selections = Object.create(null) as Record<string, boolean | string>;
  Object.defineProperty(selections, '__proto__', {
    enumerable: true,
    value: true,
  });
  const input = Object.assign(Object.create(null), { selections });
  const decoded = decodeAgentConfigurationSelection(input);

  expect(Object.keys(decoded.selections)).toEqual(['__proto__']);
  expect(Object.hasOwn(decoded.selections, '__proto__')).toBe(true);
  expect(decoded.selections['__proto__']).toBe(true);
});

test('normalizes reflective boundary failures to TypeError', () => {
  const input = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new Error('reflection failed');
      },
    },
  );

  expect(() => decodeAgentConfigurationSelection(input)).toThrow(TypeError);
});
