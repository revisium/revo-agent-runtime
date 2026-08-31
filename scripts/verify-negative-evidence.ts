import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const oxfmt = join(root, 'node_modules/.bin/oxfmt');
const knip = join(root, 'node_modules/.bin/knip');
const tsc = join(root, 'node_modules/.bin/tsc');
const publint = join(root, 'node_modules/.bin/publint');

const expectFailure = (command: string, args: readonly string[], label: string): void => {
  assert.throws(
    () => execFileSync(command, [...args], { cwd: root, stdio: 'pipe' }),
    `${label} must reject its deliberate invalid fixture.`,
  );
};

const fixtureRoot = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-negative-'));

try {
  const unformatted = join(fixtureRoot, 'unformatted.ts');
  const typeError = join(fixtureRoot, 'type-error.ts');
  const invalidPackage = join(fixtureRoot, 'invalid-package');
  const deadExportProject = join(fixtureRoot, 'dead-export-project');

  await writeFile(unformatted, 'export   {};\n');
  await writeFile(typeError, 'const message: string = 1;\nvoid message;\n');
  await mkdir(invalidPackage);
  await mkdir(deadExportProject);
  await writeFile(
    join(invalidPackage, 'package.json'),
    `${JSON.stringify({ name: 'invalid-package', version: '0.0.0', exports: './missing.js' })}\n`,
  );
  await writeFile(
    join(deadExportProject, 'package.json'),
    `${JSON.stringify({ name: 'dead-export-project', private: true, type: 'module' })}\n`,
  );
  await writeFile(
    join(deadExportProject, 'knip.json'),
    `${JSON.stringify({ entry: ['index.ts'], project: ['*.ts'] })}\n`,
  );
  await writeFile(
    join(deadExportProject, 'index.ts'),
    "import { used } from './library.js';\nvoid used;\n",
  );
  await writeFile(
    join(deadExportProject, 'library.ts'),
    'export const used = 1;\nexport const dead = 2;\n',
  );

  expectFailure(oxfmt, ['--check', unformatted], 'Formatting');
  expectFailure(
    tsc,
    [
      '--noEmit',
      '--strict',
      '--target',
      'ES2024',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      typeError,
    ],
    'TypeScript',
  );
  expectFailure(publint, [invalidPackage], 'Publint package-export validation');
  assert.throws(
    () =>
      execFileSync(knip, ['--exports', '--no-progress'], { cwd: deadExportProject, stdio: 'pipe' }),
    'Dead-export validation must reject its deliberate unused export.',
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log('Negative format, type, and package-export evidence passed.');
