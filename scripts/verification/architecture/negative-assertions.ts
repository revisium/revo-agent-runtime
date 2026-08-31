import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { validateLayerImports } from './layers.js';
import type { SourceModule } from './source-modules.js';
import { validateDomainStructure } from './structure.js';

export const runArchitectureLint = (root: string, paths: readonly string[]): void => {
  const oxlint = join(root, 'node_modules/.bin/oxlint');
  const architectureConfig = join(root, '.oxlintrc.architecture.json');
  execFileSync(oxlint, ['--config', architectureConfig, '--deny-warnings', ...paths], {
    cwd: root,
    stdio: 'pipe',
  });
};

const outputFor = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return String(error);
  const stdout = 'stdout' in error ? error.stdout : '';
  const stderr = 'stderr' in error ? error.stderr : '';
  const asText = (value: unknown): string =>
    Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  return `${asText(stdout)}${asText(stderr)}`;
};

export const expectArchitectureLintFailure = (
  root: string,
  paths: readonly string[],
  rule: string,
): void => {
  assert.throws(
    () => runArchitectureLint(root, paths),
    (error: unknown) => outputFor(error).includes(rule),
    `Expected ${rule} to reject the representative architecture violation.`,
  );
};

export const expectRuleFailure = (module: SourceModule, rule: string): void => {
  assert.throws(
    () => validateLayerImports(module),
    (error: unknown) => error instanceof Error && error.message.includes(`[${rule}]`),
    `Expected ${rule} to reject the representative architecture violation.`,
  );
};

export const expectStructureFailure = (modules: readonly SourceModule[], rule: string): void => {
  assert.throws(
    () => validateDomainStructure(modules),
    (error: unknown) => error instanceof Error && error.message.includes(`[${rule}]`),
    `Expected ${rule} to reject the representative structure violation.`,
  );
};
