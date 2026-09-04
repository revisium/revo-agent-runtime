import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { expectArchitectureLintFailure, expectRuleFailure } from '../../negative-assertions.js';
import {
  requireNodeAdapterBoundaries,
  requireProtocolNeutrality,
} from '../../runtime-boundaries.js';
import { validatePublicExportMap } from '../../structure.js';

export const runBaseDependencyProbes = async (root: string): Promise<void> => {
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
    assert.throws(
      () =>
        requireProtocolNeutrality([
          {
            path: 'src/execution/forbidden.ts',
            source: "import '@agentclientprotocol/sdk';\nexport {};\n",
          },
        ]),
      /\[protocol-neutral-core\]/,
    );
    assert.throws(
      () =>
        requireNodeAdapterBoundaries([
          { path: 'src/application/forbidden.ts', source: "import 'node:path';\nexport {};\n" },
        ]),
      /\[node-application-boundary\]/,
    );
    assert.throws(
      () =>
        requireProtocolNeutrality([
          { path: 'src/protocol/driver.ts', source: "import 'node:child_process';\nexport {};\n" },
        ]),
      /\[protocol-port-leaf\]/,
    );
    assert.throws(
      () =>
        requireProtocolNeutrality([
          {
            path: 'src/protocol/acp/driver.ts',
            source: "import '../../application/manager/manager.js';\nexport {};\n",
          },
        ]),
      /\[acp-adapter-boundary\]/,
    );
    assert.throws(
      () => validatePublicExportMap({ '.': './dist/index.js', './private': './dist/private.js' }),
      /\[root-export-only\]/,
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
