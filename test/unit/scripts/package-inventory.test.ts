import { expect, test } from 'vitest';

import { expectedPackedPaths } from '../../../scripts/verification/package/inventory.js';

test('derives the exact packed inventory from source modules, including nested additions', () => {
  expect(expectedPackedPaths(['session/actor.ts', 'index.ts'])).toEqual([
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'dist/index.d.ts',
    'dist/index.d.ts.map',
    'dist/index.js',
    'dist/index.js.map',
    'dist/session/actor.d.ts',
    'dist/session/actor.d.ts.map',
    'dist/session/actor.js',
    'dist/session/actor.js.map',
    'package.json',
  ]);
});

test('does not expect emitted artifacts for ambient declarations or non-TypeScript files', () => {
  expect(expectedPackedPaths(['discovery/which.d.ts', 'README.md'])).toEqual([
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'package.json',
  ]);
});
