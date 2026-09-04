import assert from 'node:assert/strict';

import type { SourceModule } from '../../source-modules.js';

const productionLineLimit = 360;
const readerFacingTestLineLimit = 250;
const verificationEntrypointLineLimit = 120;
const verificationModuleLineLimit = 280;

export const validateBaseProductionSize = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (
      !module.path.startsWith('src/contracts/') &&
      module.source.split('\n').length > productionLineLimit
    ) {
      throw new Error(`[oversized-module] ${module.path}`);
    }
  }
};

export const validateBaseReaderFacingTestSize = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (
      module.path.endsWith('.test.ts') &&
      module.source.split('\n').length > readerFacingTestLineLimit
    ) {
      throw new Error(`[oversized-reader-test] ${module.path}`);
    }
  }
};

export const validateVerificationEntrypoint = (path: string, source: string): void => {
  if (source.split('\n').length > verificationEntrypointLineLimit) {
    throw new Error(`[oversized-verification-entrypoint] ${path}`);
  }
};

export const validateBaseVerificationSize = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (module.source.split('\n').length > verificationModuleLineLimit) {
      throw new Error(`[oversized-verification-module] ${module.path}`);
    }
  }
};

export const runBaseSizeProbes = (sourceModules: readonly SourceModule[]): void => {
  assert.throws(
    () =>
      validateBaseProductionSize([
        ...sourceModules,
        {
          path: 'src/execution/output/oversized.ts',
          source: 'export {};\n'.repeat(productionLineLimit + 1),
        },
      ]),
    (error: unknown) => error instanceof Error && error.message.includes('[oversized-module]'),
    'Expected the production module size limit to reject a representative regression.',
  );
  assert.throws(
    () =>
      validateBaseReaderFacingTestSize([
        {
          path: 'test/unit/reader/oversized-reader.test.ts',
          source: 'test();\n'.repeat(readerFacingTestLineLimit + 1),
        },
      ]),
    (error: unknown) => error instanceof Error && error.message.includes('[oversized-reader-test]'),
    'Expected the reader-facing test size limit to reject a representative regression.',
  );
  assert.throws(
    () => validateVerificationEntrypoint('scripts/verify-example.ts', 'verify();\n'.repeat(121)),
    (error: unknown) =>
      error instanceof Error && error.message.includes('[oversized-verification-entrypoint]'),
    'Expected oversized verification entrypoints to require cohesive verification modules.',
  );
  assert.throws(
    () =>
      validateBaseVerificationSize([
        {
          path: 'scripts/verification/architecture/monolith.ts',
          source: 'verify();\n'.repeat(281),
        },
      ]),
    (error: unknown) =>
      error instanceof Error && error.message.includes('[oversized-verification-module]'),
    'Expected verification responsibilities to remain in bounded modules.',
  );
};
