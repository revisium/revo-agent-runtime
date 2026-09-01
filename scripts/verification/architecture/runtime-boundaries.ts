import { importSpecifiers, type SourceModule } from './source-modules.js';

const hasImport = (module: SourceModule, expression: RegExp): boolean =>
  importSpecifiers(module.source).some((specifier) =>
    expression.test(specifier.replace(/\.js$/, '')),
  );

export const requireProtocolNeutrality = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (module.path.startsWith('src/application/') || module.path.startsWith('src/execution/')) {
      if (
        hasImport(module, /^@agentclientprotocol\//) ||
        hasImport(module, /(?:^|\/)protocol\/acp$/)
      )
        throw new Error(`[protocol-neutral-core] ${module.path}`);
    }
    if (module.path === 'src/protocol/driver.ts') {
      if (
        hasImport(module, /^(?:@agentclientprotocol\/|node:)/) ||
        hasImport(module, /application\//)
      )
        throw new Error(`[protocol-port-leaf] ${module.path}`);
    }
    if (module.path.startsWith('src/protocol/acp/')) {
      if (hasImport(module, /(?:^|\/)(?:application\/|invocation-result|active-state|index$)/))
        throw new Error(`[acp-adapter-boundary] ${module.path}`);
    }
  }
};

export const requireNodeAdapterBoundaries = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (
      (module.path.startsWith('src/application/') || module.path.startsWith('src/execution/')) &&
      hasImport(module, /^(?:execa|node:child_process)$/)
    )
      throw new Error(`[node-process-boundary] ${module.path}`);
    if (module.path.startsWith('src/application/') && hasImport(module, /^node:/))
      throw new Error(`[node-application-boundary] ${module.path}`);
  }
};

const requireProductionOnlyModules = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (module.path.startsWith('src/') && /(?:fake-native|test\/support)/.test(module.source))
      throw new Error(`[test-driver-production-leak] ${module.path}`);
  }
};

export const validateRuntimeBoundaries = (modules: readonly SourceModule[]): void => {
  requireProtocolNeutrality(modules);
  requireNodeAdapterBoundaries(modules);
  requireProductionOnlyModules(modules);
};
