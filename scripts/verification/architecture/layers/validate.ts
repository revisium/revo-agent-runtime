import { importSpecifiers, resolvedRelativeModule, type SourceModule } from '../source-modules.js';
import { baseDependenciesFor } from './base-policy.js';
import { sourceLayer } from './classify.js';
import { sessionDependenciesFor } from './session-policy.js';

const isPublicAggregator = (path: string): boolean =>
  path === 'src/contracts/session.ts' || path === 'src/index.ts';

const isSessionInternalBarrel = (path: string): boolean =>
  /\/session\/(?:.+\/)?index\.ts$/.test(path);

export const validateLayerImports = (module: SourceModule): void => {
  const layer = sourceLayer(module.path);
  if (layer === undefined) throw new Error(`[source-layout] ${module.path}`);
  if (isSessionInternalBarrel(module.path))
    throw new Error(`[session-internal-barrel] ${module.path}`);

  const dependencies = sessionDependenciesFor(layer) ?? baseDependenciesFor(layer);
  if (dependencies === undefined) throw new Error(`[source-layout] ${module.path}`);

  for (const specifier of importSpecifiers(module.source)) {
    const target = resolvedRelativeModule(module.path, specifier);
    if (target?.includes('/session/') && target.endsWith('/index.ts')) {
      throw new Error(`[session-internal-barrel] ${module.path} -> ${specifier}`);
    }
    if (
      isPublicAggregator(module.path) &&
      target === 'src/contracts/session/continuation/envelope.ts'
    ) {
      throw new Error(`[private-continuation-export] ${module.path} -> ${specifier}`);
    }
    const targetLayer = target === undefined ? undefined : sourceLayer(target);
    if (targetLayer !== undefined && !dependencies.includes(targetLayer)) {
      throw new Error(`[layer-dependency] ${module.path} -> ${specifier}`);
    }
  }
};
