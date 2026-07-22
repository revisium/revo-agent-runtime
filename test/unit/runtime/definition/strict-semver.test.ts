import { expect, test } from 'vitest';

import {
  compareSemVer,
  parseStrictSemVer,
  type StrictSemVer,
} from '../../../../src/runtime/definition/index.js';

const semVer = (value: string): StrictSemVer => {
  const parsed = parseStrictSemVer(value);
  if (!parsed) throw new Error(`Expected ${value} to be strict SemVer.`);

  return parsed;
};

test('parses and deeply freezes the string-preserving strict SemVer fields', () => {
  const parsed = parseStrictSemVer('1.2.3-alpha.1+build.7');

  expect(parsed).toEqual({
    source: '1.2.3-alpha.1+build.7',
    core: ['1', '2', '3'],
    prerelease: ['alpha', '1'],
    build: ['build', '7'],
  });
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed?.core)).toBe(true);
  expect(Object.isFrozen(parsed?.prerelease)).toBe(true);
  expect(Object.isFrozen(parsed?.build)).toBe(true);
});

test('rejects non-ASCII and non-strict SemVer partitions', () => {
  for (const value of [
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3+',
    'v1.2.3',
    '1.2.3\n',
    '1.2.3-beta_1',
    '1.2.3-β',
  ]) {
    expect(parseStrictSemVer(value)).toBeUndefined();
  }
});

test('compares arbitrary-length decimal core identifiers without numeric coercion', () => {
  expect(
    compareSemVer(semVer('999999999999999999999999.0.0'), semVer('1000000000000000000000000.0.0')),
  ).toBe(-1);
  expect(
    compareSemVer(semVer('1.1000000000000000000000000.0'), semVer('1.999999999999999999999999.0')),
  ).toBe(1);
});

test('follows the standard prerelease precedence chain', () => {
  const values = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];

  for (const [index, value] of values.entries()) {
    const next = values[index + 1];
    if (next) expect(compareSemVer(semVer(value), semVer(next))).toBe(-1);
  }
});

test('treats mixed prerelease identifiers as nonnumeric', () => {
  expect(compareSemVer(semVer('1.0.0-1a'), semVer('1.0.0-999'))).toBe(1);
});

test('ignores build metadata during comparison', () => {
  expect(compareSemVer(semVer('1.2.3+left.1'), semVer('1.2.3+right.2'))).toBe(0);
});
