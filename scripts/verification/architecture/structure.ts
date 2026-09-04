import {
  builtInProviderIds,
  providerNameExpression,
  providerPathExpression,
} from '../shared/providers.js';
import {
  validateBaseProductionSize,
  validateBaseReaderFacingTestSize,
  validateBaseVerificationSize,
} from './probes/size/base.js';
import { validateSessionVerifierSize } from './probes/size/session.js';
import { importSpecifiers, type SourceModule } from './source-modules.js';

const packageExportMap = (value: unknown): value is { readonly '.': unknown } =>
  typeof value === 'object' && value !== null && '.' in value;

export const validatePublicExportMap = (exports: unknown): void => {
  if (!packageExportMap(exports) || Object.keys(exports).length !== 1) {
    throw new Error('[root-export-only] package.json must expose only the package root');
  }
};

const requiredDomainModules = Object.freeze([
  'src/application/active-state/lane.ts',
  'src/application/faults/agent-faults.ts',
  'src/application/invocation/preflight.ts',
  'src/application/manager/manager.ts',
  'src/application/result/invocation-result.ts',
  'src/definition/composition.ts',
  'src/definition/identity.ts',
  'src/definition/schema.ts',
  'src/definition/validation.ts',
  'src/execution/invocation/executor.ts',
  'src/execution/output/publication.ts',
  'src/execution/process/port.ts',
  'src/execution/result/normalizer.ts',
  'src/execution/security/redaction/channel.ts',
  'src/execution/security/redaction/engine.ts',
  'src/execution/security/redaction/rules.ts',
  'src/platform/node/process/spawner.ts',
  'src/protocol/acp/driver.ts',
  ...builtInProviderIds.flatMap((provider) => [
    `src/providers/${provider}/definition.ts`,
    `src/providers/${provider}/detector.ts`,
  ]),
  'src/providers/index.ts',
]);

const retiredFlatModules = Object.freeze([
  'src/application/manager.ts',
  'src/discovery/builtins.ts',
  'src/execution/invocation.ts',
  'src/execution/redaction-channel.ts',
  'src/platform/node-process.ts',
  'src/protocol/acp.ts',
]);

export { validateVerificationEntrypoint } from './probes/size/base.js';

export const validateDomainStructure = (modules: readonly SourceModule[]): void => {
  const paths = new Set(modules.map(({ path }) => path));
  for (const required of requiredDomainModules) {
    if (!paths.has(required)) throw new Error(`[required-domain-module] ${required}`);
  }
  for (const retired of retiredFlatModules) {
    if (paths.has(retired)) throw new Error(`[retired-flat-module] ${retired}`);
  }

  for (const module of modules) {
    if (
      module.path.startsWith('src/discovery/') &&
      /(?:adjacent-node-package|bundled-bridge|node-entrypoint|node-platform)/.test(module.path)
    )
      throw new Error(`[node-discovery-adapter] ${module.path}`);
    if (/^src\/(?:application|execution)\/[^/]+\.ts$/.test(module.path))
      throw new Error(`[flat-feature-root] ${module.path}`);
    if (module.path.startsWith('src/discovery/') && providerNameExpression.test(module.source))
      throw new Error(`[provider-policy-in-discovery] ${module.path}`);
  }

  const sharedProviderModules = modules.filter(
    ({ path }) => /^src\/providers\/[^/]+\.ts$/.test(path) && path !== 'src/providers/index.ts',
  );
  for (const module of sharedProviderModules) {
    if (providerNameExpression.test(module.source))
      throw new Error(`[mixed-provider-policy] ${module.path}`);
  }

  for (const provider of builtInProviderIds) {
    const folder = `src/providers/${provider}/`;
    const owned = modules.filter(({ path }) => path.startsWith(folder));
    if (owned.length < 2) throw new Error(`[provider-folder-incomplete] ${provider}`);
    for (const module of owned) {
      for (const specifier of importSpecifiers(module.source)) {
        const referencedProvider = providerPathExpression.exec(specifier)?.[1];
        if (referencedProvider !== undefined && referencedProvider.toLowerCase() !== provider)
          throw new Error(`[cross-provider-import] ${module.path}`);
      }
    }
  }
  validateBaseProductionSize(modules);
};

export const validateReaderFacingTestStructure = (modules: readonly SourceModule[]): void => {
  for (const module of modules) {
    if (/^test\/(?:unit|contract|integration)\/[^/]+\.test\.ts$/.test(module.path))
      throw new Error(`[flat-test-lane] ${module.path}`);
    if (/^test\/support\/[^/]+\.ts$/.test(module.path))
      throw new Error(`[flat-test-support] ${module.path}`);
  }
  validateBaseReaderFacingTestSize(modules);
};

export const validateAcceptanceStructure = (modules: readonly SourceModule[]): void => {
  const paths = new Set(modules.map(({ path }) => path));
  for (const module of modules) {
    if (/^scripts\/smoke-[^/]+\.ts$/.test(module.path))
      throw new Error(`[manual-smoke-entrypoint] ${module.path}`);
    if (module.path.startsWith('support/'))
      throw new Error(`[root-support-retired] ${module.path}`);
  }
  for (const required of [
    'test/smoke/discover.ts',
    'test/smoke/agent.ts',
    'test/smoke/configuration.ts',
    'test/smoke/recovery.ts',
  ]) {
    if (!paths.has(required)) throw new Error(`[required-smoke-entrypoint] ${required}`);
  }
  for (const required of [
    'test/support/fake-acp/agent.ts',
    'test/support/fake-acp/definition.ts',
  ]) {
    if (!paths.has(required)) throw new Error(`[required-fake-acp-support] ${required}`);
  }
};

export const validateVerificationModuleStructure = (modules: readonly SourceModule[]): void => {
  validateBaseVerificationSize(modules);
  validateSessionVerifierSize(modules);
};
