import {
  compileConsumerSchema,
  validateConsumerSchemaProfile,
} from '../../../src/runtime/definition/index.js';
import {
  ExecutionBindingToken,
  InvocationInputSnapshot,
  InvocationLifecycle,
  PreparedLaunch,
  type NormalizedInvocationOutcome,
  type ResultSchemaValidator,
} from '../../../src/runtime/execution/index.js';
import { FakeInvocationClock } from '../execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../execution/fake-execution-port.js';
import { FakeOutputClaimPort } from '../execution/fake-output-claim-port.js';
import { FakeInvocationOutputPort } from '../execution/fake-output-port.js';
import { FakeOutputPreparationPort } from '../execution/fake-output-preparation-port.js';

const bindingToken = (agentId: string, definitionDigest: string): ExecutionBindingToken =>
  ExecutionBindingToken.create({
    agentId,
    agentVersion: '1.0.0',
    definitionDigest,
    protocolDriverId: 'native/stdio-v1',
    resultParserId: 'codex-jsonl/v1',
    permissionStrategyId: 'codex-cli/v1',
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
  });

const resultSchema = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
});
const resultSchemaPath = '/resultSchema';

export interface AcceptedInvocationLifecycleSubject {
  readonly clock: FakeInvocationClock;
  readonly execution: FakeInvocationExecutionPort;
  readonly lifecycle: InvocationLifecycle;
  readonly output: FakeInvocationOutputPort;
  terminalSettlements(): readonly NormalizedInvocationOutcome[];
}

export const createAcceptedInvocationLifecycleSubject = (
  validator: ResultSchemaValidator,
): AcceptedInvocationLifecycleSubject => {
  const snapshot = InvocationInputSnapshot.create({
    invocationId: 'accepted-lifecycle',
    agent: { id: 'fixture-agent', version: '1.0.0' },
    prompt: 'Return JSON.',
    workspace: { directory: '/workspace/project' },
    parameters: {},
    permissions: {},
    result: { schema: resultSchema },
    output: { directory: '/outputs/invocation' },
  });
  if (snapshot === undefined)
    throw new Error('Unable to create an accepted lifecycle input snapshot.');

  const profile = validateConsumerSchemaProfile(snapshot.resultSchema, resultSchemaPath);
  if (!profile.valid) throw new Error('Unable to admit the accepted lifecycle result schema.');
  compileConsumerSchema(profile.schema, resultSchemaPath);
  const preparedLaunch = PreparedLaunch.create({
    pin: {
      agentId: 'fixture-agent',
      agentVersion: '1.0.0',
      definitionDigest: 'fixture-definition-digest',
    },
    executable: '/resolved/fixture-agent',
    reportedVersion: '1.0.0',
    limits: snapshot.limits,
    effectiveParameters: {},
    effectivePermissions: {},
    childEnvironment: {},
    childEnvironmentSecretValues: [],
    secretValues: [],
    resultSchemaValidator: validator,
    outputResourcePlan: {
      invocationId: 'accepted-invocation',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: false,
    },
    interpretedArgumentTemplate: [{ kind: 'arguments', arguments: ['exec'] }],
    preparedPayloads: { arguments: ['exec'], files: [] },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
    bindingToken: bindingToken('fixture-agent', 'fixture-definition-digest'),
  });
  if (preparedLaunch === undefined)
    throw new Error('Unable to create accepted prepared launch evidence.');

  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const settlements: NormalizedInvocationOutcome[] = [];
  const lifecycle = new InvocationLifecycle(
    {
      execution,
      clock,
      output,
      outputPreparation: new FakeOutputPreparationPort('prepared'),
      outputClaim: new FakeOutputClaimPort('created'),
      workspace: {
        admit: async () =>
          Object.freeze({ status: 'admitted' as const, directory: '/workspace/project' }),
      },
    },
    snapshot,
    preparedLaunch,
    (settlement) => settlements.push(settlement),
  );

  return Object.freeze({
    clock,
    execution,
    lifecycle,
    output,
    terminalSettlements: () => Object.freeze([...settlements]),
  });
};
