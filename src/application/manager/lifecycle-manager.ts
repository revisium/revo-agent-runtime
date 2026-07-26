import {
  compileConsumerSchema,
  validateConsumerSchemaProfile,
} from '../../runtime/definition/index.js';
import {
  InvocationInputSnapshot,
  InvocationLifecycle,
  type InvocationExecutionPorts,
  type ResultSchemaValidator,
} from '../../runtime/execution/index.js';
import type { JsonObject } from '../../runtime/spec/index.js';

type RejectionReason =
  | 'invalid_request'
  | 'invalid_result_schema'
  | 'duplicate_invocation'
  | 'output_prepare_failed';
type LifecycleStartOutcome =
  | Readonly<{ status: 'rejected'; reason: RejectionReason }>
  | Readonly<{ status: 'accepted'; lifecycle: InvocationLifecycle }>;

const resultSchemaPath = '/resultSchema';
const resultValuePath = '/result';

const createResultSchemaValidator = (
  snapshot: InvocationInputSnapshot,
): ResultSchemaValidator | undefined => {
  const profile = validateConsumerSchemaProfile(snapshot.resultSchema, resultSchemaPath);
  if (!profile.valid) return undefined;
  try {
    const compiled = compileConsumerSchema(profile.schema, resultSchemaPath);
    return Object.freeze({
      validate: (value: JsonObject) => compiled.validate(value, resultValuePath),
    });
  } catch {
    return undefined;
  }
};

class InternalInvocationLifecycleManager {
  private readonly activeIds = new Set<string>();

  constructor(private readonly ports: InvocationExecutionPorts) {}

  async start(input: unknown): Promise<LifecycleStartOutcome> {
    const snapshot = InvocationInputSnapshot.create(input);
    if (snapshot === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    const resultSchemaValidator = createResultSchemaValidator(snapshot);
    if (resultSchemaValidator === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_result_schema' });
    try {
      await this.ports.output.prepare();
    } catch {
      return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
    }
    if (this.activeIds.has(snapshot.invocationId))
      return Object.freeze({ status: 'rejected', reason: 'duplicate_invocation' });
    this.activeIds.add(snapshot.invocationId);
    const lifecycle = new InvocationLifecycle(
      this.ports,
      snapshot,
      () => {
        this.activeIds.delete(snapshot.invocationId);
      },
      resultSchemaValidator,
    );
    lifecycle.begin();
    return Object.freeze({ status: 'accepted', lifecycle });
  }
}

export const createInvocationLifecycleManager = (
  ports: InvocationExecutionPorts,
): Readonly<{ start(input: unknown): Promise<LifecycleStartOutcome> }> =>
  Object.freeze(new InternalInvocationLifecycleManager(ports));
