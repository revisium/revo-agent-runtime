import { runBaseDependencyProbes } from './probes/dependency/base.js';
import { runSessionDependencyProbes } from './probes/dependency/session.js';
import { runBaseLayoutProbes } from './probes/layout/base.js';
import { runSessionLayoutProbes } from './probes/layout/session.js';
import { runBaseSizeProbes } from './probes/size/base.js';
import { runSessionSizeProbes } from './probes/size/session.js';
import type { SourceModule } from './source-modules.js';

export const runNegativeArchitectureProbes = async (
  root: string,
  sourceModules: readonly SourceModule[],
): Promise<void> => {
  await runBaseDependencyProbes(root);
  runSessionDependencyProbes();
  runBaseLayoutProbes(sourceModules);
  runSessionLayoutProbes();
  runBaseSizeProbes(sourceModules);
  runSessionSizeProbes();
};
