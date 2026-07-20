import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import {
  validateModuleStructure,
  type SourceModule,
} from './architecture/validate-module-structure.js';

interface CommandFailureDetails {
  readonly status: number | null;
  readonly output: string;
}

const commandOutputText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
};

const commandFailureDetails = (error: unknown): CommandFailureDetails => {
  if (typeof error !== 'object' || error === null) {
    return { status: null, output: String(error) };
  }

  const status: unknown = 'status' in error ? error.status : undefined;
  const stdout: unknown = 'stdout' in error ? error.stdout : undefined;
  const stderr: unknown = 'stderr' in error ? error.stderr : undefined;

  return {
    status: typeof status === 'number' || status === null ? status : null,
    output: `${commandOutputText(stdout)}${commandOutputText(stderr)}`,
  };
};

const root = process.cwd();
const oxlint = join(root, 'node_modules/.bin/oxlint');
const config = join(root, '.oxlintrc.architecture.json');

const collectTypeScriptModules = async (directory: string): Promise<readonly SourceModule[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const modules = await Promise.all(
    entries.map(async (entry): Promise<readonly SourceModule[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptModules(path);
      if (!entry.name.endsWith('.ts')) return [];

      return [
        {
          path: relative(root, path).replaceAll('\\', '/'),
          source: await readFile(path, 'utf8'),
        },
      ];
    }),
  );

  return modules.flat();
};

const runArchitectureLint = (paths: readonly string[]): string => {
  try {
    return execFileSync(oxlint, ['--config', config, '--deny-warnings', ...paths], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error: unknown) {
    const failure = commandFailureDetails(error);
    throw new Error(`Architecture lint failed unexpectedly.\n${failure.output}`, { cause: error });
  }
};

const expectArchitectureFailure = (paths: readonly string[], expectedRule: string): void => {
  try {
    execFileSync(oxlint, ['--config', config, '--deny-warnings', ...paths], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error: unknown) {
    const failure = commandFailureDetails(error);
    assert.notEqual(failure.status, 0, 'A representative architecture violation must fail');
    assert.ok(
      failure.output.includes(expectedRule),
      `Expected architecture failure from ${expectedRule}`,
    );
    return;
  }

  assert.fail(`Expected architecture probe to fail with ${expectedRule}`);
};

const expectStructureFailure = (module: SourceModule, expectedRule: string): void => {
  assert.throws(
    () => validateModuleStructure([module]),
    (error: unknown) => error instanceof Error && error.message.includes(`[${expectedRule}]`),
    `Expected module-structure failure from ${expectedRule}`,
  );
};

validateModuleStructure([
  ...(await collectTypeScriptModules(join(root, 'src'))),
  ...(await collectTypeScriptModules(join(root, 'test'))),
]);
runArchitectureLint(['src', 'test/package']);

const structureProbes: readonly (readonly [SourceModule, string])[] = [
  [
    {
      path: 'src/runtime/spec/json/runtime-value.ts',
      source: 'export const runtimeValue = true;\n',
    },
    'spec-type-only',
  ],
  [
    {
      path: 'src/runtime/spec/json/non-type-import.ts',
      source: "import { value } from './json-value.js';\nexport type Invalid = typeof value;\n",
    },
    'spec-type-only',
  ],
  [
    {
      path: 'src/runtime/policy/multiple.ts',
      source: 'export const first = true;\nexport const second = true;\n',
    },
    'one-export-per-leaf',
  ],
  [
    {
      path: 'src/runtime/policy/destructured.ts',
      source: 'export const { first, nested: { second } } = source;\n',
    },
    'one-export-per-leaf',
  ],
  [
    {
      path: 'src/runtime/spec/json/index.ts',
      source: "export * from './json-value.js';\n",
    },
    'explicit-barrel-exports',
  ],
  [
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source:
        "import type { JsonPrimitive } from './json-primitive';\nexport type JsonValue = JsonPrimitive;\n",
    },
    'relative-js-suffix',
  ],
  [
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source:
        "import type { JsonPrimitive } from './index.js';\nexport type JsonValue = JsonPrimitive;\n",
    },
    'own-barrel-import',
  ],
  [
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source: "export type { JsonPrimitive } from './index.js';\n",
    },
    'own-barrel-import',
  ],
  [
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source:
        "import type { JsonPrimitive } from '../index.js';\nexport type JsonValue = JsonPrimitive;\n",
    },
    'spec-layer-barrel-import',
  ],
  [
    {
      path: 'src/runtime/spec/agent-fault/agent-fault.ts',
      source:
        "import type { AgentRef } from '../agent-definition/agent-descriptor.js';\nexport interface AgentFault { readonly agent: AgentRef }\n",
    },
    'cross-domain-barrel-import',
  ],
  [
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "import { AGENT_RUNTIME_LIMITS } from '../../policy/limits/agent-runtime-limits.js';\nexport const inspectPlainJson = AGENT_RUNTIME_LIMITS;\n",
    },
    'cross-layer-barrel-import',
  ],
  [
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "export const loadLimits = () => import('../../policy/limits/agent-runtime-limits.js');\n",
    },
    'cross-layer-barrel-import',
  ],
  [
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "const target = '../../policy/limits/agent-runtime-limits.js';\nexport const loadLimits = () => import(target);\n",
    },
    'relative-js-suffix',
  ],
  [
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "import limits = require('../../policy/limits/agent-runtime-limits.js');\nexport const inspectPlainJson = limits;\n",
    },
    'cross-layer-barrel-import',
  ],
  [
    {
      path: 'src/runtime/definition/plain-json/plain-json-inspection.ts',
      source:
        "export type PlainJsonInspection = import('../../policy/limits/agent-runtime-limits.js').AGENT_RUNTIME_LIMITS;\n",
    },
    'cross-layer-barrel-import',
  ],
  [
    {
      path: 'test/unit/runtime/definition/plain-json.test.ts',
      source:
        "import { inspectPlainJson } from '../../../../src/runtime/definition/plain-json/index.js';\nvoid inspectPlainJson;\n",
    },
    'test-layer-barrel-import',
  ],
  [
    {
      path: 'test/unit/runtime/definition/plain-json.test.ts',
      source: "void import('../../../../src/runtime/definition/plain-json/index.js');\n",
    },
    'test-layer-barrel-import',
  ],
  [
    {
      path: 'src/runtime/spec/json/index.ts',
      source: "export type { JsonObjectBase } from './json-object-base.js';\n",
    },
    'json-object-base-private',
  ],
];

for (const [module, expectedRule] of structureProbes) {
  expectStructureFailure(module, expectedRule);
}

const probeRoot = await mkdtemp(join(root, '.architecture-probe-'));

try {
  const forbiddenSpec = join(probeRoot, 'src/runtime/spec/forbidden.ts');
  const forbiddenApplication = join(probeRoot, 'src/application/manager.ts');
  await mkdir(dirname(forbiddenSpec), { recursive: true });
  await mkdir(dirname(forbiddenApplication), { recursive: true });
  await writeFile(forbiddenApplication, 'export const manager = true;\n');
  await writeFile(
    forbiddenSpec,
    "import { manager } from '../../application/manager.js';\nexport const leaked = manager;\n",
  );
  expectArchitectureFailure([relative(root, forbiddenSpec)], 'no-restricted-imports');

  const consumerProbe = join(probeRoot, 'test/integration/consumer/private-spec.ts');
  const privateSpec = join(probeRoot, 'src/runtime/spec/agent-definition.ts');
  await mkdir(dirname(consumerProbe), { recursive: true });
  await writeFile(privateSpec, 'export interface AgentDefinition {}\n');
  await writeFile(
    consumerProbe,
    "import type { AgentDefinition } from '../../../src/runtime/spec/agent-definition.js';\nexport type LeakedDefinition = AgentDefinition;\n",
  );
  expectArchitectureFailure([relative(root, consumerProbe)], 'no-restricted-imports');

  const cycleA = join(probeRoot, 'src/cycle/a.ts');
  const cycleB = join(probeRoot, 'src/cycle/b.ts');
  await mkdir(dirname(cycleA), { recursive: true });
  await writeFile(
    cycleA,
    "import type { B } from './b.js';\nexport interface A { readonly b: B }\n",
  );
  await writeFile(
    cycleB,
    "import type { A } from './a.js';\nexport interface B { readonly a: A }\n",
  );
  expectArchitectureFailure([relative(root, cycleA), relative(root, cycleB)], 'import(no-cycle)');
} finally {
  await rm(probeRoot, { recursive: true, force: true });
}

console.log('Architecture validation passed (positive graph and negative probes).');
