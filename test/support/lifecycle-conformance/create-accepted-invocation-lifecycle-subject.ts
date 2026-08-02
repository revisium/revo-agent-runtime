import {
  compileConsumerSchema,
  validateConsumerSchemaProfile,
} from '../../../src/runtime/definition/index.js';
import {
  InvocationInputSnapshot,
  InvocationLifecycle,
  PreparedLaunch,
  type NormalizedInvocationOutcome,
  type ResultSchemaValidator,
} from '../../../src/runtime/execution/index.js';
import { FakeInvocationClock } from '../execution/fake-clock.js';
import { FakeInvocationExecutionPort } from '../execution/fake-execution-port.js';
import { FakeInvocationOutputPort } from '../execution/fake-output-port.js';

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
    resultSchema,
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
  });
  if (preparedLaunch === undefined)
    throw new Error('Unable to create accepted prepared launch evidence.');

  const clock = new FakeInvocationClock({ initialNowMs: 0 });
  const execution = new FakeInvocationExecutionPort();
  const output = new FakeInvocationOutputPort();
  const settlements: NormalizedInvocationOutcome[] = [];
  const lifecycle = new InvocationLifecycle(
    { execution, clock, output },
    snapshot,
    preparedLaunch,
    (settlement) => settlements.push(settlement),
    validator,
  );

  return Object.freeze({
    clock,
    execution,
    lifecycle,
    output,
    terminalSettlements: () => Object.freeze([...settlements]),
  });
};
