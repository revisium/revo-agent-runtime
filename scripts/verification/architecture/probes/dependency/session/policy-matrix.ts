import { dirname, relative } from 'node:path';

import { builtInProviderIds } from '../../../../shared/providers.js';
import { sourceLayer, type SourceLayer } from '../../../layers/classify.js';
import { expectRuleFailure, expectRuleSuccess } from '../../../negative-assertions.js';

const layerPaths: Partial<Record<SourceLayer, string>> = {
  contracts: 'src/contracts/manager/core.ts',
  'contracts-session': 'src/contracts/session/api/manager.ts',
  'contracts-session-continuation-envelope': 'src/contracts/session/continuation/envelope.ts',
  'definition-foundation': 'src/definition/errors.ts',
  'definition-profile': 'src/definition/schema-profile.ts',
  'definition-core': 'src/definition/schema.ts',
  'configuration-core': 'src/configuration/catalog.ts',
  'discovery-platform': 'src/discovery/platform.ts',
  'platform-discovery': 'src/platform/node/discovery/path.ts',
  'discovery-runner': 'src/discovery/runner.ts',
  'discovery-root': 'src/discovery/index.ts',
  'providers-shared': 'src/providers/shared.ts',
  'providers-composition': 'src/providers/index.ts',
  'application-active-state': 'src/application/active-state/lane.ts',
  'application-configuration': 'src/application/configuration/options.ts',
  'application-faults': 'src/application/faults/agent-faults.ts',
  'application-invocation': 'src/application/invocation/preflight.ts',
  'application-result': 'src/application/result/invocation-result.ts',
  'application-manager': 'src/application/manager/manager.ts',
  'application-session-boundary': 'src/application/session/boundary/input/open.ts',
  'application-session-policy': 'src/application/session/policy/limits/resolve.ts',
  'application-session-management': 'src/application/session/management/facade.ts',
  'application-session-handles': 'src/application/session/handles/session.ts',
  'execution-invocation': 'src/execution/invocation/executor.ts',
  'execution-configuration': 'src/execution/configuration/inspector.ts',
  'execution-output': 'src/execution/output/publication.ts',
  'execution-session-output-port': 'src/execution/output/session/publication.ts',
  'execution-result': 'src/execution/result/normalizer.ts',
  'execution-security': 'src/execution/security/redaction/channel.ts',
  'execution-security-digest-port': 'src/execution/security/digest/port.ts',
  'execution-probe': 'src/execution/probe/executable.ts',
  'execution-process': 'src/execution/process/literal-launch.ts',
  'execution-process-port': 'src/execution/process/port.ts',
  'session-kernel': 'src/execution/session/kernel/reducer/reduce.ts',
  'session-kernel-effects': 'src/execution/session/kernel/effect/event.ts',
  'session-kernel-public-command': 'src/execution/session/kernel/command/public.ts',
  'session-runtime': 'src/execution/session/runtime/mailbox/queue.ts',
  'session-runtime-dispatch': 'src/execution/session/runtime/actor/port.ts',
  'session-runtime-identity-port': 'src/execution/session/runtime/primitives/identity.ts',
  'session-runtime-outcome-port': 'src/execution/session/runtime/effects/outcomes.ts',
  'session-interpreter': 'src/execution/session/interpreter/event/deliver.ts',
  'platform-output': 'src/platform/node/output/claim.ts',
  'platform-session-output': 'src/platform/node/output/session/publisher.ts',
  'platform-probe': 'src/platform/node/probe/executable-probe.ts',
  'platform-process': 'src/platform/node/process/spawner.ts',
  'platform-session-primitives': 'src/platform/node/session/primitives/identity.ts',
  'platform-security-digest': 'src/platform/node/security/digest.ts',
  'protocol-driver': 'src/protocol/driver.ts',
  'protocol-session': 'src/protocol/session/port/driver.ts',
  'protocol-acp': 'src/protocol/acp/driver.ts',
  'protocol-acp-session': 'src/protocol/acp/session/composition/driver.ts',
  root: 'src/index.ts',
  ...Object.fromEntries(
    builtInProviderIds.map((provider) => [
      `providers-${provider}`,
      `src/providers/${provider}/definition.ts`,
    ]),
  ),
};

type SessionPolicyProbe = readonly [SourceLayer, readonly SourceLayer[]];

const sessionPolicies = [
  ['contracts-session', ['contracts', 'contracts-session']],
  ['contracts-session-continuation-envelope', ['contracts', 'contracts-session']],
  [
    'session-kernel',
    [
      'contracts',
      'contracts-session',
      'session-kernel',
      'session-kernel-effects',
      'session-kernel-public-command',
    ],
  ],
  [
    'session-kernel-effects',
    ['contracts', 'contracts-session', 'session-kernel', 'session-kernel-effects'],
  ],
  ['session-kernel-public-command', ['contracts', 'contracts-session', 'session-kernel']],
  ['protocol-session', ['configuration-core', 'contracts', 'protocol-session']],
  [
    'session-runtime',
    [
      'contracts-session',
      'session-kernel',
      'session-kernel-effects',
      'session-kernel-public-command',
      'session-runtime',
      'session-runtime-dispatch',
      'session-runtime-identity-port',
      'session-runtime-outcome-port',
    ],
  ],
  ['session-runtime-dispatch', ['contracts-session', 'session-kernel-public-command']],
  ['session-runtime-identity-port', ['contracts', 'contracts-session']],
  ['session-runtime-outcome-port', ['contracts-session', 'session-kernel-effects']],
  ['execution-security-digest-port', ['contracts']],
  ['execution-session-output-port', ['contracts', 'contracts-session']],
  [
    'session-interpreter',
    [
      'contracts',
      'contracts-session',
      'contracts-session-continuation-envelope',
      'execution-session-output-port',
      'execution-process-port',
      'execution-security-digest-port',
      'protocol-session',
      'session-kernel-effects',
      'session-runtime-identity-port',
      'session-runtime-outcome-port',
    ],
  ],
  [
    'application-session-boundary',
    [
      'application-session-boundary',
      'contracts',
      'contracts-session',
      'contracts-session-continuation-envelope',
      'definition-foundation',
      'execution-security-digest-port',
    ],
  ],
  [
    'application-session-policy',
    [
      'application-session-policy',
      'contracts',
      'contracts-session',
      'definition-core',
      'definition-foundation',
      'definition-profile',
    ],
  ],
  [
    'application-session-management',
    [
      'application-session-boundary',
      'application-session-management',
      'application-session-policy',
      'contracts',
      'contracts-session',
      'session-runtime-dispatch',
    ],
  ],
  [
    'application-session-handles',
    [
      'application-session-handles',
      'contracts',
      'contracts-session',
      'session-kernel-public-command',
      'session-runtime-dispatch',
    ],
  ],
  [
    'protocol-acp-session',
    ['configuration-core', 'contracts', 'protocol-acp', 'protocol-acp-session', 'protocol-session'],
  ],
  [
    'platform-session-output',
    ['execution-session-output-port', 'platform-output', 'platform-process'],
  ],
  ['platform-session-primitives', ['session-runtime-identity-port']],
  ['platform-security-digest', ['execution-security-digest-port']],
] as const satisfies readonly SessionPolicyProbe[];

export const sessionModuleWithImport = (path: string, target: string) => {
  const specifier = relative(dirname(path), target).replace(/\.ts$/, '.js').replaceAll('\\', '/');
  return {
    path,
    source: `import '${specifier.startsWith('.') ? specifier : `./${specifier}`}';\nexport {};\n`,
  };
};

const pathFor = (layer: SourceLayer): string => {
  const path = layerPaths[layer];
  if (path === undefined) throw new Error(`[session-probe-layer] ${layer}`);
  return path;
};

const verifySessionPolicy = (layer: SourceLayer, allowed: readonly SourceLayer[]): void => {
  for (const target of Object.values(layerPaths)) {
    const targetLayer = sourceLayer(target);
    if (targetLayer === undefined) throw new Error(`[session-probe-layer] ${target}`);
    const module = sessionModuleWithImport(pathFor(layer), target);
    if (allowed.includes(targetLayer)) expectRuleSuccess(module);
    else expectRuleFailure(module, 'layer-dependency');
  }
};

export const runSessionPolicyMatrix = (): void => {
  for (const [layer, allowed] of sessionPolicies) verifySessionPolicy(layer, allowed);
};
