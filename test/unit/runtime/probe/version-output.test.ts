import { expect, test } from 'vitest';

import { parseVersionOutput } from '../../../../src/runtime/probe/index.js';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

test.each([
  ['1.2.3', undefined],
  ['1.2.3\n', undefined],
  ['1.2.3\r\n', undefined],
  ['tool 1.2.3\n', 'tool '],
])('extracts %j', (text, prefix) => {
  const result = parseVersionOutput({ bytes: encode(text), prefix });

  expect(result).toEqual({
    valid: true,
    version: { source: '1.2.3', core: ['1', '2', '3'], prerelease: [], build: [] },
  });
  expect(Object.isFrozen(result)).toBe(true);
});

test.each([
  [new Uint8Array([0xc3, 0x28]), undefined, 'invalid_utf8'],
  [encode('1.2.3\0'), undefined, 'nul'],
  [encode('1.2.3\nnext'), undefined, 'line_break'],
  [encode(' 1.2.3'), undefined, 'surrounding_whitespace'],
  [encode('1.2.3 '), undefined, 'surrounding_whitespace'],
  [encode('tool '), 'tool ', 'surrounding_whitespace'],
  [new Uint8Array([0xef, 0xbb, 0xbf, ...encode('1.2.3')]), undefined, 'surrounding_whitespace'],
  [encode('Tool 1.2.3'), 'tool ', 'prefix_mismatch'],
  [encode('tool'), 'tool', 'empty_version'],
  [encode('tool v1.2.3'), 'tool ', 'invalid_semver'],
] as const)('returns package reason %#', (bytes, prefix, reason) => {
  expect(parseVersionOutput({ bytes, prefix })).toEqual({ valid: false, reason });
});

test.each(['1.2.3\r', '1.2.3\u2028', '1.2.3\u2029', '1.2.3\n\n', '1.2.3\r\n\n'])(
  'rejects remaining line breaks in %j',
  (value) => {
    expect(parseVersionOutput({ bytes: encode(value) })).toEqual({
      valid: false,
      reason: 'line_break',
    });
  },
);

test.each(['\t1.2.3', '1.2.3\t', '\u00a01.2.3', '1.2.3\u00a0'])(
  'rejects surrounding whitespace in %j',
  (value) => {
    expect(parseVersionOutput({ bytes: encode(value) })).toEqual({
      valid: false,
      reason: 'surrounding_whitespace',
    });
  },
);

test('matches prefixes exactly and case-sensitively', () => {
  expect(parseVersionOutput({ bytes: encode('Tool 1.2.3'), prefix: 'Tool ' })).toEqual({
    valid: true,
    version: { source: '1.2.3', core: ['1', '2', '3'], prerelease: [], build: [] },
  });
  expect(parseVersionOutput({ bytes: encode('Tool 1.2.3'), prefix: 'tool ' })).toEqual({
    valid: false,
    reason: 'prefix_mismatch',
  });
});

test('rejects NUL before applying a prefix', () => {
  expect(parseVersionOutput({ bytes: encode('to\0ol 1.2.3'), prefix: 'tool ' })).toEqual({
    valid: false,
    reason: 'nul',
  });
});

test('rejects an empty selected output as an empty version', () => {
  expect(parseVersionOutput({ bytes: new Uint8Array([]) })).toEqual({
    valid: false,
    reason: 'empty_version',
  });
});

test('preserves prerelease and build fields from strict SemVer parsing', () => {
  const result = parseVersionOutput({ bytes: encode('1.0.0-alpha.1+build.7') });

  expect(result).toEqual({
    valid: true,
    version: {
      source: '1.0.0-alpha.1+build.7',
      core: ['1', '0', '0'],
      prerelease: ['alpha', '1'],
      build: ['build', '7'],
    },
  });
  expect(Object.isFrozen(result)).toBe(true);
});

test('does not mutate or retain the caller byte array', () => {
  const bytes = encode('1.2.3');
  const snapshot = new Uint8Array(bytes);
  const result = parseVersionOutput({ bytes });

  expect(bytes).toEqual(snapshot);
  bytes[0] = 0x39;
  expect(result).toEqual({
    valid: true,
    version: { source: '1.2.3', core: ['1', '2', '3'], prerelease: [], build: [] },
  });
});
