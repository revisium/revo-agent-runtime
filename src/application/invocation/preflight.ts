import {
  AgentManagerError,
  type AgentExecutionPin,
  type AgentStartContext,
  type StartAgentInvocation,
} from '../../contracts/manager.js';
import type { SealedAgentRegistry, ValidatedAgentDefinition } from '../../definition/index.js';
import {
  captureEnvironment,
  type CapturedEnvironment,
} from '../../execution/invocation/environment.js';
import { compileResultSchema } from '../../execution/result/schema-validator.js';
import { fault, managerError } from '../faults/agent-faults.js';
import { type EffectiveLimits, invocationLimits } from '../manager/limits.js';
import { snapshotStartRequest } from './start-request-snapshot.js';

export interface PreparedInvocationRequest {
  readonly definition: ValidatedAgentDefinition;
  readonly limits: EffectiveLimits;
  readonly pin: AgentExecutionPin;
  readonly request: StartAgentInvocation;
}

export const prepareInvocationRequest = (
  value: unknown,
  definitions: SealedAgentRegistry,
  managerLimits: EffectiveLimits,
): PreparedInvocationRequest => {
  const request = snapshotStartRequest(value);
  try {
    compileResultSchema(request.result.schema);
  } catch {
    throw new AgentManagerError(
      fault('revo.agent.definition_invalid', 'Agent result schema is invalid.', 'preflight'),
    );
  }
  const definition = definitions.get(request.agent);
  if (definition === undefined)
    throw managerError('revo.agent.agent_unknown', 'Agent reference is unknown.');
  return Object.freeze({
    definition,
    limits: invocationLimits(request.limits, managerLimits),
    pin: Object.freeze({
      agentId: definition.definition.id,
      agentVersion: definition.definition.version,
      definitionDigest: definition.digest,
    }),
    request,
  });
};

export const captureStartEnvironment = (
  context: AgentStartContext | undefined,
): CapturedEnvironment => {
  try {
    return captureEnvironment(context?.environment, process.env);
  } catch {
    throw new AgentManagerError(
      fault('revo.agent.definition_invalid', 'Agent environment is invalid.', 'preflight'),
    );
  }
};
