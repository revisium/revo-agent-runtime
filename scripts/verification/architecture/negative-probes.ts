import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import {
  expectArchitectureLintFailure,
  expectRuleFailure,
  expectStructureFailure,
} from './negative-assertions.js';
import { requireNodeAdapterBoundaries, requireProtocolNeutrality } from './runtime-boundaries.js';
import type { SourceModule } from './source-modules.js';
import {
  productionLineLimit,
  readerFacingTestLineLimit,
  validatePublicExportMap,
  validateAcceptanceStructure,
  validateReaderFacingTestStructure,
  validateVerificationEntrypoint,
  validateVerificationModuleStructure,
} from './structure.js';
export const runNegativeArchitectureProbes = async (
  root: string,
  sourceModules: readonly SourceModule[],
): Promise<void> => {
  const probeRoot = await mkdtemp(join(root, '.architecture-probe-'));

  try {
    const probes = [
      {
        path: join(probeRoot, 'src/forbidden.ts'),
        source: "import '../test/support.js';\nexport {};\n",
      },
      {
        path: join(probeRoot, 'src/contracts/forbidden.ts'),
        source: "import { readFile } from 'node:fs/promises';\nvoid readFile;\n",
      },
      {
        path: join(probeRoot, 'src/application/forbidden.ts'),
        source: "import '@agentclientprotocol/sdk';\nexport {};\n",
      },
      {
        path: join(probeRoot, 'src/discovery/forbidden.ts'),
        source: "import '../application/manager/manager.js';\nexport {};\n",
      },
    ];
    await Promise.all(
      probes.map(async (probe) => {
        await mkdir(dirname(probe.path), { recursive: true });
        await writeFile(probe.path, probe.source, { encoding: 'utf8', flag: 'wx' });
      }),
    );

    for (const probe of probes) {
      expectArchitectureLintFailure(root, [relative(root, probe.path)], 'no-restricted-imports');
    }
    expectRuleFailure(
      {
        path: 'src/definition/schema-profile.ts',
        source: "import './index.js';\nexport {};\n",
      },
      'layer-dependency',
    );
    for (const module of [
      {
        path: 'src/application/manager/probe-agent.ts',
        source: "import '../../platform/node/probe/executable-probe.js';\nexport {};\n",
      },
      {
        path: 'src/execution/probe/executable-preflight.ts',
        source: "import '../../application/manager/manager.js';\nexport {};\n",
      },
      {
        path: 'src/platform/node/output/publication.ts',
        source: "import '../../../application/manager/manager.js';\nexport {};\n",
      },
    ]) {
      expectRuleFailure(module, 'layer-dependency');
    }
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
      [
        ...sourceModules,
        {
          path: 'src/execution/output/oversized.ts',
          source: 'export {};\n'.repeat(productionLineLimit + 1),
        },
      ],
      'oversized-module',
    );
    assert.throws(
      () =>
        validateAcceptanceStructure([{ path: 'scripts/smoke-example.ts', source: 'export {};\n' }]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[manual-smoke-entrypoint]'),
      'Expected manual smoke entrypoints to live under test/smoke.',
    );
    assert.throws(
      () =>
        validateAcceptanceStructure([
          { path: 'support/fake-acp/agent.ts', source: 'export {};\n' },
        ]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[root-support-retired]'),
      'Expected fake ACP support to remain beneath test/support.',
    );
    assert.throws(
      () =>
        validateReaderFacingTestStructure([
          {
            path: 'test/unit/reader/oversized-reader.test.ts',
            source: 'test();\n'.repeat(readerFacingTestLineLimit + 1),
          },
        ]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[oversized-reader-test]'),
      'Expected oversized-reader-test to reject a reader-facing regression.',
    );
    assert.throws(
      () => validateVerificationEntrypoint('scripts/verify-example.ts', 'verify();\n'.repeat(121)),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[oversized-verification-entrypoint]'),
      'Expected oversized verification entrypoints to require cohesive verification modules.',
    );
    assert.throws(
      () =>
        validateVerificationModuleStructure([
          {
            path: 'scripts/verification/architecture/monolith.ts',
            source: 'verify();\n'.repeat(281),
          },
        ]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[oversized-verification-module]'),
      'Expected verification responsibilities to remain in bounded modules.',
    );
    assert.throws(
      () =>
        validateReaderFacingTestStructure([
          { path: 'test/unit/flat-reader.test.ts', source: 'test();\n' },
        ]),
      (error: unknown) => error instanceof Error && error.message.includes('[flat-test-lane]'),
      'Expected unit tests to remain grouped below their domain directory.',
    );
    assert.throws(
      () =>
        validateReaderFacingTestStructure([
          { path: 'test/support/flat-helper.ts', source: 'export {};\n' },
        ]),
      (error: unknown) => error instanceof Error && error.message.includes('[flat-test-support]'),
      'Expected test support to remain grouped by its reader-facing role.',
    );
    expectStructureFailure(
      [...sourceModules, { path: 'src/discovery/builtins.ts', source: 'export {};\n' }],
      'retired-flat-module',
    );
    assert.throws(
      () =>
        requireProtocolNeutrality([
          {
            path: 'src/execution/forbidden.ts',
            source: "import '@agentclientprotocol/sdk';\nexport {};\n",
          },
        ]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[protocol-neutral-core]'),
      'Expected application and execution to reject a concrete ACP dependency.',
    );
    assert.throws(
      () =>
        requireNodeAdapterBoundaries([
          {
            path: 'src/application/forbidden.ts',
            source: "import 'node:path';\nexport {};\n",
          },
        ]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[node-application-boundary]'),
      'Expected application to reject direct Node platform ownership.',
    );
    assert.throws(
      () =>
        requireProtocolNeutrality([
          {
            path: 'src/protocol/driver.ts',
            source: "import 'node:child_process';\nexport {};\n",
          },
        ]),
      (error: unknown) => error instanceof Error && error.message.includes('[protocol-port-leaf]'),
      'Expected the protocol port to remain a portable leaf.',
    );
    assert.throws(
      () =>
        requireProtocolNeutrality([
          {
            path: 'src/protocol/acp/driver.ts',
            source: "import '../../application/manager/manager.js';\nexport {};\n",
          },
        ]),
      (error: unknown) =>
        error instanceof Error && error.message.includes('[acp-adapter-boundary]'),
      'Expected ACP translation to reject application ownership.',
    );
    assert.throws(
      () => validatePublicExportMap({ '.': './dist/index.js', './private': './dist/private.js' }),
      (error: unknown) => error instanceof Error && error.message.includes('[root-export-only]'),
      'Expected a private package subpath to be rejected.',
    );

    const cycleA = join(probeRoot, 'src/cycle/a.ts');
    const cycleB = join(probeRoot, 'src/cycle/b.ts');
    await mkdir(dirname(cycleA), { recursive: true });
    await writeFile(cycleA, "import './b.js';\nexport {};\n", { encoding: 'utf8', flag: 'wx' });
    await writeFile(cycleB, "import './a.js';\nexport {};\n", { encoding: 'utf8', flag: 'wx' });
    expectArchitectureLintFailure(
      root,
      [relative(root, cycleA), relative(root, cycleB)],
      'no-cycle',
    );
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
  }
};
