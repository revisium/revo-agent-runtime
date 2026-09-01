import { expect, test } from 'vitest';

import {
  snapshotConfigurationInspection,
  snapshotConfigurationSelection,
} from '../../../../src/application/configuration/request.js';

const inspection = () => ({
  agent: { id: 'codex', version: '1.0.0' },
  workspace: { directory: '/workspace' },
});

test('snapshots exact configuration inspection and selection inputs', () => {
  expect(snapshotConfigurationInspection(inspection())).toEqual(inspection());
  expect(snapshotConfigurationSelection(undefined)).toBeUndefined();
  expect(snapshotConfigurationSelection({ selections: { fast: false, model: 'one' } })).toEqual({
    selections: { fast: false, model: 'one' },
  });
  expect(snapshotConfigurationSelection({ catalogRevision: 'revision', selections: {} })).toEqual({
    catalogRevision: 'revision',
    selections: {},
  });
  expect(snapshotConfigurationSelection({ selections: { agent: '' } })).toEqual({
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
  { selections: { '': 'value' } },
  { selections: { ['x'.repeat(257)]: 'value' } },
  { selections: { [Symbol('model')]: 'value' } },
  { selections: {}, catalogRevision: '' },
  { selections: {}, catalogRevision: 'x'.repeat(129) },
  { selections: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [index, 'value'])) },
])('rejects malformed selection input %#', (value) => {
  expect(() => snapshotConfigurationSelection(value)).toThrow();
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

  expect(() => snapshotConfigurationSelection({ selections })).toThrow();
  expect(accessed).toBe(false);
});
