import assert from 'node:assert/strict';

import type { SourceModule } from '../../source-modules.js';

const sessionProductionLineTarget = 240;
const sessionProductionLineStop = 300;
const sessionReaderFacingTestLineTarget = 180;
const sessionVerifierLineTarget = 240;
const architectureEntrypointLineTarget = 120;

const physicalLineCount = (source: string): number =>
  source === '' ? 0 : source.replace(/\r?\n$/, '').split(/\r?\n/).length;

const isSessionProduction = (path: string): boolean =>
  /^src\/(?:application|execution|contracts|protocol)\/session(?:\/|\.ts$)/.test(path) ||
  /^src\/protocol\/acp\/session\//.test(path) ||
  /^src\/platform\/node\/(?:output\/session|session\/primitives)\//.test(path) ||
  path === 'src/platform/node/security/digest.ts' ||
  path === 'src/execution/security/digest/port.ts';

const isSessionReaderArtifact = (path: string): boolean =>
  /^test\/(?:types\/session|contract\/(?:fixtures\/session|session)|unit\/(?:application\/session|execution\/session|protocol\/acp\/session)|integration\/session|e2e\/session|support\/session|smoke\/session)\//.test(
    path,
  ) && path.endsWith('.ts');

export const validateSessionProductionSize = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (!isSessionProduction(module.path)) continue;
    const lines = physicalLineCount(module.source);
    if (lines > sessionProductionLineStop)
      throw new Error(`[session-production-stop] ${module.path}`);
    if (lines > sessionProductionLineTarget) {
      throw new Error(`[session-production-target] ${module.path}`);
    }
  }
};

export const validateSessionReaderFacingTestSize = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (
      isSessionReaderArtifact(module.path) &&
      physicalLineCount(module.source) > sessionReaderFacingTestLineTarget
    ) {
      throw new Error(`[session-reader-test-target] ${module.path}`);
    }
  }
};

export const validateSessionVerifierSize = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (
      module.path.startsWith('scripts/verification/architecture/') &&
      physicalLineCount(module.source) > sessionVerifierLineTarget
    ) {
      throw new Error(`[session-verifier-target] ${module.path}`);
    }
  }
};

export const validateSessionArchitectureEntrypoint = (path: string, source: string): void => {
  if (
    path === 'scripts/verify-architecture.ts' &&
    physicalLineCount(source) > architectureEntrypointLineTarget
  ) {
    throw new Error(`[session-architecture-entrypoint-target] ${path}`);
  }
};

const sourceWithPhysicalLines = (lines: number): string =>
  Array.from({ length: lines }, () => 'verify();').join('\n');

export const runSessionSizeProbes = (): void => {
  assert.doesNotThrow(
    () =>
      validateSessionVerifierSize([
        {
          path: 'scripts/verification/architecture/probes/dependency/session.ts',
          source: sourceWithPhysicalLines(sessionVerifierLineTarget),
        },
      ]),
    'Expected a 240-line session verifier module to pass.',
  );
  assert.throws(
    () =>
      validateSessionVerifierSize([
        {
          path: 'scripts/verification/architecture/probes/dependency/session.ts',
          source: sourceWithPhysicalLines(sessionVerifierLineTarget + 1),
        },
      ]),
    /\[session-verifier-target\]/,
    'Expected a 241-line session verifier module to fail.',
  );
  assert.doesNotThrow(
    () =>
      validateSessionArchitectureEntrypoint(
        'scripts/verify-architecture.ts',
        sourceWithPhysicalLines(architectureEntrypointLineTarget),
      ),
    'Expected the 120-line architecture entrypoint to pass.',
  );
  assert.throws(
    () =>
      validateSessionArchitectureEntrypoint(
        'scripts/verify-architecture.ts',
        sourceWithPhysicalLines(architectureEntrypointLineTarget + 1),
      ),
    /\[session-architecture-entrypoint-target\]/,
    'Expected the 121-line architecture entrypoint to fail.',
  );
  for (const path of [
    'src/contracts/session/api/oversized.ts',
    'src/application/session/management/oversized.ts',
    'src/execution/session/interpreter/oversized.ts',
    'src/protocol/session/port/oversized.ts',
    'src/protocol/acp/session/lifecycle/oversized.ts',
    'src/platform/node/output/session/oversized.ts',
  ]) {
    assert.throws(
      () =>
        validateSessionProductionSize([
          { path, source: 'export {};\n'.repeat(sessionProductionLineTarget + 1) },
        ]),
      /\[session-production-target\]/,
      `Expected the session production target to reject ${path}.`,
    );
  }
  assert.throws(
    () =>
      validateSessionProductionSize([
        {
          path: 'src/execution/session/kernel/reducer/stop.ts',
          source: 'export {};\n'.repeat(sessionProductionLineStop + 1),
        },
      ]),
    (error: unknown) =>
      error instanceof Error && error.message.includes('[session-production-stop]'),
    'Expected the session production stop to reject an architecture-review-sized module.',
  );
  for (const path of [
    'test/types/session/oversized.ts',
    'test/contract/fixtures/session/requirements/oversized.ts',
    'test/contract/session/specification/requirements/source-manifest.contract.test.ts',
    'test/unit/application/session/boundary/oversized.test.ts',
    'test/unit/execution/session/kernel/oversized.test.ts',
    'test/unit/protocol/acp/session/lifecycle/oversized.test.ts',
    'test/integration/session/fresh/oversized.test.ts',
    'test/e2e/session/lifecycle/oversized.e2e.test.ts',
    'test/support/session/specification/fixtures/read-requirements.ts',
    'test/smoke/session/runner/oversized.ts',
  ]) {
    assert.throws(
      () =>
        validateSessionReaderFacingTestSize([
          { path, source: 'test();\n'.repeat(sessionReaderFacingTestLineTarget + 1) },
        ]),
      /\[session-reader-test-target\]/,
      `Expected the session reader-facing limit to reject ${path}.`,
    );
  }
};
