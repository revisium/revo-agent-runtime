import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

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

runArchitectureLint(['src', 'test/package']);

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
  await writeFile(cycleA, "import { b } from './b.js';\nexport const a = b;\n");
  await writeFile(cycleB, "import { a } from './a.js';\nexport const b = a;\n");
  expectArchitectureFailure([relative(root, cycleA), relative(root, cycleB)], 'import(no-cycle)');
} finally {
  await rm(probeRoot, { recursive: true, force: true });
}

console.log('Architecture validation passed (positive graph and negative probes).');
