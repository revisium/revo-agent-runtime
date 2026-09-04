import { expectRuleFailure, expectRuleSuccess } from '../../negative-assertions.js';
import { runParsedSessionImportProbes } from './session/parsed-imports.js';
import { runSessionPolicyMatrix, sessionModuleWithImport } from './session/policy-matrix.js';

const runSessionBoundaryProbes = (): void => {
  for (const [path, target] of [
    [
      'src/application/session/management/facade.ts',
      'src/execution/session/runtime/mailbox/queue.ts',
    ],
    [
      'src/application/session/handles/session.ts',
      'src/execution/session/runtime/resources/provider-sessions.ts',
    ],
    [
      'src/execution/session/interpreter/event/deliver.ts',
      'src/execution/session/runtime/mailbox/queue.ts',
    ],
    [
      'src/execution/session/interpreter/process/cleanup.ts',
      'src/execution/process/literal-launch.ts',
    ],
    [
      'src/protocol/acp/session/composition/driver.ts',
      'src/execution/session/kernel/reducer/reduce.ts',
    ],
    ['src/platform/node/output/session/publisher.ts', 'src/contracts/session/api/manager.ts'],
  ] as const)
    expectRuleFailure(sessionModuleWithImport(path, target), 'layer-dependency');
  for (const [path, target] of [
    ['src/protocol/acp/session/composition/driver.ts', 'src/protocol/acp/driver.ts'],
    [
      'src/platform/node/output/session/publisher.ts',
      'src/execution/output/session/publication.ts',
    ],
    ['src/execution/session/interpreter/process/cleanup.ts', 'src/execution/process/port.ts'],
  ] as const)
    expectRuleSuccess(sessionModuleWithImport(path, target));
  expectRuleSuccess({
    path: 'src/index.ts',
    source: "export type {} from './contracts/session.js';\n",
  });
  expectRuleFailure(
    {
      path: 'src/index.ts',
      source: "export type {} from './contracts/session/continuation/envelope.js';\n",
    },
    'private-continuation-export',
  );
  expectRuleFailure(
    {
      path: 'src/contracts/session.ts',
      source: "export type {} from './session/continuation/envelope.js';\n",
    },
    'private-continuation-export',
  );
  expectRuleFailure(
    { path: 'src/execution/session/kernel/index.ts', source: 'export {};\n' },
    'session-internal-barrel',
  );
  expectRuleFailure(
    {
      path: 'src/execution/session/kernel/reducer/reduce.ts',
      source: "import '../index.js';\nexport {};\n",
    },
    'session-internal-barrel',
  );
};

export const runSessionDependencyProbes = (): void => {
  runSessionPolicyMatrix();
  runParsedSessionImportProbes();
  runSessionBoundaryProbes();
};
