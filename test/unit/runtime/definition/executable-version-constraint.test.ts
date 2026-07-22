import { expect, test } from 'vitest';

import {
  matchesExecutableVersionConstraint,
  parseExecutableVersionConstraint,
  parseStrictSemVer,
  type ExecutableVersionConstraint,
  type StrictSemVer,
} from '../../../../src/runtime/definition/index.js';

const constraint = (value: string): ExecutableVersionConstraint => {
  const parsed = parseExecutableVersionConstraint(value);
  if (!parsed) throw new Error(`Expected ${value} to be an executable-version constraint.`);

  return parsed;
};

const semVer = (value: string): StrictSemVer => {
  const parsed = parseStrictSemVer(value);
  if (!parsed) throw new Error(`Expected ${value} to be strict SemVer.`);

  return parsed;
};

test('parses and deeply freezes ordered AND comparators', () => {
  const parsed = parseExecutableVersionConstraint('>=1.2.3-alpha.1 <2.0.0+build.1');

  expect(parsed).toEqual({
    source: '>=1.2.3-alpha.1 <2.0.0+build.1',
    comparators: [
      {
        operator: '>=',
        version: {
          source: '1.2.3-alpha.1',
          core: ['1', '2', '3'],
          prerelease: ['alpha', '1'],
          build: [],
        },
      },
      {
        operator: '<',
        version: {
          source: '2.0.0+build.1',
          core: ['2', '0', '0'],
          prerelease: [],
          build: ['build', '1'],
        },
      },
    ],
  });
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed?.comparators)).toBe(true);
  expect(Object.isFrozen(parsed?.comparators[0])).toBe(true);
  expect(Object.isFrozen(parsed?.comparators[0]?.version)).toBe(true);
});

test('accepts only single U+0020 separators between comparator tokens', () => {
  expect(parseExecutableVersionConstraint('=1.2.3 >=1.0.0')).toBeDefined();

  for (const value of [' =1.2.3', '=1.2.3 ', '=1.2.3  >=1.0.0']) {
    expect(parseExecutableVersionConstraint(value)).toBeUndefined();
  }
});

test('rejects tab, newline, and non-breaking-space separators', () => {
  for (const separator of ['\t', '\n', '\u00a0']) {
    expect(parseExecutableVersionConstraint(`=1.2.3${separator}>=1.0.0`)).toBeUndefined();
  }
});

test('rejects bare, malformed, and npm-style ranges', () => {
  for (const value of [
    '1.2.3',
    '>= 1.2.3',
    '=>1.2.3',
    '^1.2.3',
    '~1.2.3',
    '1.x',
    '1.2.3 - 2.0.0',
    '>=1.2.3, <2.0.0',
    '(>=1.2.3)',
    '>=1.2.3 || <2.0.0',
    '>=1.2.03',
  ]) {
    expect(parseExecutableVersionConstraint(value)).toBeUndefined();
  }
});

test('requires every comparator to match', () => {
  const range = constraint('>=1.2.3 <2.0.0');

  expect(matchesExecutableVersionConstraint(semVer('1.2.3'), range)).toBe(true);
  expect(matchesExecutableVersionConstraint(semVer('1.9.9'), range)).toBe(true);
  expect(matchesExecutableVersionConstraint(semVer('2.0.0'), range)).toBe(false);
  expect(matchesExecutableVersionConstraint(semVer('1.2.2'), range)).toBe(false);
});

test('parses and matches equality, greater-than, and less-than-or-equal comparators', () => {
  expect(matchesExecutableVersionConstraint(semVer('1.2.3+build.1'), constraint('=1.2.3'))).toBe(
    true,
  );
  expect(matchesExecutableVersionConstraint(semVer('1.2.4'), constraint('>1.2.3'))).toBe(true);
  expect(matchesExecutableVersionConstraint(semVer('1.2.3'), constraint('<=1.2.3'))).toBe(true);
  expect(matchesExecutableVersionConstraint(semVer('1.2.4'), constraint('<=1.2.3'))).toBe(false);
});

test('matches prereleases by direct SemVer comparison', () => {
  const range = constraint('>=1.2.3-alpha <1.2.3');
  const numericPrereleaseLowerBound = constraint('>=1.0.0-999');

  expect(matchesExecutableVersionConstraint(semVer('1.2.3-alpha.1'), range)).toBe(true);
  expect(matchesExecutableVersionConstraint(semVer('1.2.3'), range)).toBe(false);
  expect(matchesExecutableVersionConstraint(semVer('1.0.0-1a'), numericPrereleaseLowerBound)).toBe(
    true,
  );
});
