import { isBuiltInProviderId, type BuiltInProviderId } from '../../shared/providers.js';

export type SourceLayer =
  | 'contracts'
  | 'contracts-session'
  | 'contracts-session-continuation-envelope'
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
  | 'application-session-boundary'
  | 'application-session-policy'
  | 'application-session-management'
  | 'application-session-handles'
  | 'execution-invocation'
  | 'execution-configuration'
  | 'execution-output'
  | 'execution-session-output-port'
  | 'execution-result'
  | 'execution-security'
  | 'execution-security-digest-port'
  | 'execution-probe'
  | 'execution-process'
  | 'execution-process-port'
  | 'session-kernel'
  | 'session-kernel-effects'
  | 'session-kernel-public-command'
  | 'session-runtime'
  | 'session-runtime-dispatch'
  | 'session-runtime-identity-port'
  | 'session-runtime-outcome-port'
  | 'session-interpreter'
  | 'platform-output'
  | 'platform-session-output'
  | 'platform-probe'
  | 'platform-process'
  | 'platform-session-primitives'
  | 'platform-security-digest'
  | 'protocol-driver'
  | 'protocol-session'
  | 'protocol-acp'
  | 'protocol-acp-session'
  | 'root';

export const providerLayer = (provider: BuiltInProviderId): `providers-${BuiltInProviderId}` =>
  `providers-${provider}`;

export const sourceLayer = (path: string): SourceLayer | undefined => {
  if (path === 'src/index.ts') return 'root';
  if (path === 'src/contracts/session/continuation/envelope.ts')
    return 'contracts-session-continuation-envelope';
  if (path === 'src/contracts/session.ts' || path.startsWith('src/contracts/session/'))
    return 'contracts-session';
  if (path.startsWith('src/application/session/boundary/')) return 'application-session-boundary';
  if (path.startsWith('src/application/session/policy/')) return 'application-session-policy';
  if (path.startsWith('src/application/session/management/'))
    return 'application-session-management';
  if (path.startsWith('src/application/session/handles/')) return 'application-session-handles';
  if (path.startsWith('src/execution/session/kernel/effect/')) return 'session-kernel-effects';
  if (path === 'src/execution/session/kernel/command/public.ts')
    return 'session-kernel-public-command';
  if (path.startsWith('src/execution/session/kernel/')) return 'session-kernel';
  if (path === 'src/execution/session/runtime/actor/port.ts') return 'session-runtime-dispatch';
  if (path === 'src/execution/session/runtime/primitives/identity.ts')
    return 'session-runtime-identity-port';
  if (path === 'src/execution/session/runtime/effects/outcomes.ts')
    return 'session-runtime-outcome-port';
  if (path.startsWith('src/execution/session/runtime/')) return 'session-runtime';
  if (path.startsWith('src/execution/session/interpreter/')) return 'session-interpreter';
  if (path === 'src/execution/security/digest/port.ts') return 'execution-security-digest-port';
  if (path.startsWith('src/protocol/acp/session/')) return 'protocol-acp-session';
  if (path.startsWith('src/protocol/session/')) return 'protocol-session';
  if (path.startsWith('src/platform/node/output/session/')) return 'platform-session-output';
  if (path.startsWith('src/platform/node/session/primitives/'))
    return 'platform-session-primitives';
  if (path === 'src/platform/node/security/digest.ts') return 'platform-security-digest';
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
  if (path === 'src/execution/output/session/publication.ts')
    return 'execution-session-output-port';
  if (path.startsWith('src/execution/output/')) return 'execution-output';
  if (path.startsWith('src/execution/result/')) return 'execution-result';
  if (path.startsWith('src/execution/security/')) return 'execution-security';
  if (path.startsWith('src/execution/probe/')) return 'execution-probe';
  if (path === 'src/execution/process/port.ts') return 'execution-process-port';
  if (path.startsWith('src/execution/process/')) return 'execution-process';
  if (path.startsWith('src/platform/node/output/')) return 'platform-output';
  if (path.startsWith('src/platform/node/probe/')) return 'platform-probe';
  if (path.startsWith('src/platform/node/process/')) return 'platform-process';
  if (path === 'src/protocol/driver.ts' || path === 'src/protocol/configuration-driver.ts')
    return 'protocol-driver';
  if (path.startsWith('src/protocol/acp/')) return 'protocol-acp';
  return undefined;
};
