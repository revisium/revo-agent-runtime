import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateLayerImports } from './layers.js';
import { runArchitectureLint } from './negative-assertions.js';
import { runNegativeArchitectureProbes } from './negative-probes.js';
import { validateRuntimeBoundaries } from './runtime-boundaries.js';
import { collectSourceModules } from './source-modules.js';
import {
  validateDomainStructure,
  validateAcceptanceStructure,
  validatePublicExportMap,
  validateReaderFacingTestStructure,
  validateVerificationEntrypoint,
  validateVerificationModuleStructure,
} from './structure.js';

const root = process.cwd();
const sourceModules = await collectSourceModules(root, join(root, 'src'));
const testModules = await collectSourceModules(root, join(root, 'test'));
const verificationModules = await collectSourceModules(root, join(root, 'scripts/verification'));
const acceptanceModules = [
  ...(await collectSourceModules(root, join(root, 'scripts'))),
  ...testModules,
];
const packageJson: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await Promise.all(
  ['scripts/verify-architecture.ts', 'scripts/verify-package.ts'].map(async (path) => {
    validateVerificationEntrypoint(path, await readFile(join(root, path), 'utf8'));
  }),
);

validateDomainStructure(sourceModules);
validateReaderFacingTestStructure(testModules);
validateAcceptanceStructure(acceptanceModules);
validateVerificationModuleStructure(verificationModules);
if (typeof packageJson !== 'object' || packageJson === null || !('exports' in packageJson)) {
  throw new Error('package.json must declare the root export map.');
}
validatePublicExportMap(packageJson.exports);
for (const module of sourceModules) validateLayerImports(module);
validateRuntimeBoundaries(sourceModules);
runArchitectureLint(root, ['src']);
await runNegativeArchitectureProbes(root, sourceModules);

console.log('Architecture validation passed (real tree plus representative negative fixtures).');
