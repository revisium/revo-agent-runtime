import assert from 'node:assert/strict';

import { expectStructureFailure } from '../../negative-assertions.js';
import type { SourceModule } from '../../source-modules.js';
import { validateAcceptanceStructure, validateReaderFacingTestStructure } from '../../structure.js';

export const runBaseLayoutProbes = (sourceModules: readonly SourceModule[]): void => {
  expectStructureFailure(
    [...sourceModules, { path: 'src/application/flat.ts', source: 'export {};\n' }],
    'flat-feature-root',
  );
  expectStructureFailure(
    [...sourceModules, { path: 'src/discovery/node-platform.ts', source: 'export {};\n' }],
    'node-discovery-adapter',
  );
  expectStructureFailure(
    [
      ...sourceModules,
      { path: 'src/discovery/provider-leak.ts', source: "export const codex = 'mixed';\n" },
    ],
    'provider-policy-in-discovery',
  );
  expectStructureFailure(
    [
      ...sourceModules,
      { path: 'src/providers/shared-leak.ts', source: "export const claude = 'mixed';\n" },
    ],
    'mixed-provider-policy',
  );
  expectStructureFailure(
    sourceModules.map((module) =>
      module.path === 'src/providers/codex/detector.ts'
        ? { ...module, source: `${module.source}\nimport '../claude/detector.js';\n` }
        : module,
    ),
    'cross-provider-import',
  );
  expectStructureFailure(
    [...sourceModules, { path: 'src/discovery/builtins.ts', source: 'export {};\n' }],
    'retired-flat-module',
  );
  for (const [modules, rule] of [
    [[{ path: 'scripts/smoke-example.ts', source: 'export {};\n' }], 'manual-smoke-entrypoint'],
    [[{ path: 'support/fake-acp/agent.ts', source: 'export {};\n' }], 'root-support-retired'],
    [[{ path: 'test/unit/flat-reader.test.ts', source: 'test();\n' }], 'flat-test-lane'],
    [[{ path: 'test/support/flat-helper.ts', source: 'export {};\n' }], 'flat-test-support'],
  ] as const) {
    assert.throws(
      () =>
        rule === 'manual-smoke-entrypoint' || rule === 'root-support-retired'
          ? validateAcceptanceStructure(modules)
          : validateReaderFacingTestStructure(modules),
      (error: unknown) => error instanceof Error && error.message.includes(`[${rule}]`),
      `Expected [${rule}] to reject the representative layout violation.`,
    );
  }
};
