import {
  builtInProviderIds,
  isBuiltInProviderId,
  providerLayerExtensions,
  type BuiltInProviderId,
} from '../shared/providers.js';
import { importSpecifiers, resolvedRelativeModule, type SourceModule } from './source-modules.js';

type SourceLayer =
  | 'contracts'
  | 'definition-foundation'
  | 'definition-profile'
  | 'definition-core'
  | 'configuration-core'
  | 'discovery-platform'
  | 'platform-discovery'
  | 'discovery-runner'
  | 'discovery-root'
  | 'providers-shared'
  | `providers-${BuiltInProviderId}`
  | 'providers-composition'
  | 'application-active-state'
  | 'application-configuration'
  | 'application-faults'
  | 'application-invocation'
  | 'application-result'
  | 'application-manager'
  | 'execution-invocation'
  | 'execution-configuration'
  | 'execution-output'
  | 'execution-result'
  | 'execution-security'
  | 'execution-probe'
  | 'execution-process'
  | 'platform-output'
  | 'platform-probe'
  | 'platform-process'
  | 'protocol-driver'
  | 'protocol-acp'
  | 'root';

const providerLayer = (provider: BuiltInProviderId): `providers-${BuiltInProviderId}` =>
  `providers-${provider}`;

const sourceLayer = (path: string): SourceLayer | undefined => {
  if (path === 'src/index.ts') return 'root';
  if (path.startsWith('src/contracts/')) return 'contracts';
  if (path.startsWith('src/configuration/')) return 'configuration-core';
  if (
    path === 'src/definition/canonical-json.ts' ||
    path === 'src/definition/errors.ts' ||
    path === 'src/definition/registry.ts' ||
    path === 'src/definition/utf8-order.ts'
  )
    return 'definition-foundation';
  if (path === 'src/definition/schema-profile.ts') return 'definition-profile';
  if (path.startsWith('src/definition/')) return 'definition-core';
  if (path === 'src/discovery/platform.ts') return 'discovery-platform';
  if (path.startsWith('src/platform/node/discovery/')) return 'platform-discovery';
  if (path === 'src/discovery/runner.ts') return 'discovery-runner';
  if (path === 'src/discovery/index.ts') return 'discovery-root';
  if (path === 'src/providers/index.ts') return 'providers-composition';
  const provider = /^src\/providers\/([^/]+)\//.exec(path)?.[1];
  if (provider !== undefined && isBuiltInProviderId(provider)) return providerLayer(provider);
  if (path.startsWith('src/providers/')) return 'providers-shared';
  if (path.startsWith('src/application/faults/')) return 'application-faults';
  if (path.startsWith('src/application/configuration/')) return 'application-configuration';
  if (path.startsWith('src/application/manager/')) return 'application-manager';
  if (path.startsWith('src/application/active-state/')) return 'application-active-state';
  if (path.startsWith('src/application/invocation/')) return 'application-invocation';
  if (path.startsWith('src/application/result/')) return 'application-result';
  if (path.startsWith('src/execution/invocation/')) return 'execution-invocation';
  if (path.startsWith('src/execution/configuration/')) return 'execution-configuration';
  if (path.startsWith('src/execution/output/')) return 'execution-output';
  if (path.startsWith('src/execution/result/')) return 'execution-result';
  if (path.startsWith('src/execution/security/')) return 'execution-security';
  if (path.startsWith('src/execution/probe/')) return 'execution-probe';
  if (path.startsWith('src/execution/process/')) return 'execution-process';
  if (path.startsWith('src/platform/node/output/')) return 'platform-output';
  if (path.startsWith('src/platform/node/probe/')) return 'platform-probe';
  if (path.startsWith('src/platform/node/process/')) return 'platform-process';
  if (path === 'src/protocol/driver.ts' || path === 'src/protocol/configuration-driver.ts')
    return 'protocol-driver';
  if (path.startsWith('src/protocol/acp/')) return 'protocol-acp';
  return undefined;
};

const providerDependencies = (provider: BuiltInProviderId): readonly SourceLayer[] => [
  'contracts',
  'discovery-platform',
  providerLayer(provider),
  'providers-shared',
  ...(providerLayerExtensions[provider] ?? []),
];

const allowedDependencies: Readonly<Partial<Record<SourceLayer, readonly SourceLayer[]>>> = {
  contracts: ['contracts'],
  'configuration-core': ['configuration-core', 'contracts', 'definition-foundation'],
  'definition-foundation': ['contracts', 'definition-foundation'],
  'definition-profile': ['contracts', 'definition-foundation'],
  'definition-core': [
    'contracts',
    'definition-core',
    'definition-foundation',
    'definition-profile',
  ],
  'discovery-platform': ['discovery-platform'],
  'platform-discovery': ['discovery-platform', 'platform-discovery'],
  'discovery-runner': ['contracts', 'definition-foundation', 'definition-core'],
  'discovery-root': [
    'contracts',
    'discovery-platform',
    'platform-discovery',
    'discovery-runner',
    'providers-composition',
  ],
  'providers-shared': ['contracts', 'discovery-platform', 'providers-shared'],
  'providers-composition': [
    'contracts',
    'discovery-platform',
    'execution-configuration',
    'protocol-acp',
    ...builtInProviderIds.map(providerLayer),
  ],
  'application-active-state': [
    'application-active-state',
    'contracts',
    'definition-core',
    'execution-process',
  ],
  'application-configuration': ['application-configuration', 'contracts'],
  'application-faults': [
    'contracts',
    'execution-invocation',
    'execution-output',
    'execution-probe',
  ],
  'application-invocation': [
    'application-active-state',
    'application-configuration',
    'application-faults',
    'application-invocation',
    'application-manager',
    'application-result',
    'contracts',
    'definition-core',
    'execution-invocation',
    'execution-output',
    'execution-result',
  ],
  'application-result': [
    'application-faults',
    'contracts',
    'execution-invocation',
    'execution-output',
    'execution-result',
  ],
  'application-manager': [
    'application-active-state',
    'application-configuration',
    'application-faults',
    'application-invocation',
    'application-manager',
    'application-result',
    'contracts',
    'definition-core',
    'definition-profile',
    'execution-invocation',
    'execution-configuration',
    'execution-output',
    'execution-probe',
    'execution-process',
    'execution-result',
  ],
  'execution-configuration': [
    'configuration-core',
    'contracts',
    'execution-configuration',
    'execution-output',
    'execution-process',
    'protocol-driver',
  ],
  'execution-invocation': [
    'contracts',
    'execution-invocation',
    'execution-output',
    'execution-process',
    'execution-result',
    'execution-security',
    'protocol-driver',
  ],
  'execution-output': ['contracts', 'execution-output', 'execution-security'],
  'execution-result': ['contracts', 'execution-output', 'execution-result', 'execution-security'],
  'execution-security': ['execution-security'],
  'execution-probe': ['contracts', 'definition-foundation', 'execution-probe', 'execution-process'],
  'execution-process': ['contracts'],
  'platform-output': [
    'execution-invocation',
    'execution-output',
    'platform-output',
    'platform-process',
  ],
  'platform-probe': ['execution-probe', 'execution-process', 'platform-process'],
  'platform-process': ['execution-process', 'platform-process'],
  'protocol-driver': ['configuration-core', 'contracts'],
  'protocol-acp': ['configuration-core', 'contracts', 'protocol-acp', 'protocol-driver'],
  root: [
    'contracts',
    'discovery-root',
    'application-manager',
    'execution-configuration',
    'execution-invocation',
    'execution-probe',
    'platform-output',
    'platform-probe',
    'platform-process',
    'protocol-acp',
    'providers-composition',
  ],
};

const dependenciesFor = (layer: SourceLayer): readonly SourceLayer[] | undefined => {
  const provider = builtInProviderIds.find((candidate) => providerLayer(candidate) === layer);
  return provider === undefined ? allowedDependencies[layer] : providerDependencies(provider);
};

export const validateLayerImports = (module: SourceModule): void => {
  const layer = sourceLayer(module.path);
  if (layer === undefined) throw new Error(`[source-layout] ${module.path}`);

  for (const specifier of importSpecifiers(module.source)) {
    const target = resolvedRelativeModule(module.path, specifier);
    const targetLayer = target === undefined ? undefined : sourceLayer(target);
    const dependencies = dependenciesFor(layer);
    if (dependencies === undefined) throw new Error(`[source-layout] ${module.path}`);
    if (targetLayer !== undefined && !dependencies.includes(targetLayer)) {
      throw new Error(`[layer-dependency] ${module.path} -> ${specifier}`);
    }
  }
};
