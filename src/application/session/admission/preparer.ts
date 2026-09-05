import type { AgentFault } from '../../../contracts/manager/core.js';
import type { SealedAgentRegistry, ValidatedAgentDefinition } from '../../../definition/index.js';
import type {
  ClaimedInvocationOutput,
  OutputClaimPlatform,
} from '../../../execution/output/claim.js';
import type { SessionOutputPublicationTarget } from '../../../execution/output/session/publication.js';
import type { ExecutablePreflight } from '../../../execution/probe/executable-preflight.js';
import { literalArguments } from '../../../execution/process/literal-launch.js';
import type {
  PreparedSessionOpening,
  SessionOpeningPreparer,
} from '../../../execution/session/port/opening-preparation.js';
import { EffectiveInvocationInputPolicy } from '../../admission/effective-inputs.js';
import {
  prepareProcessAdmission,
  type ProcessAdmissionPreparation,
} from '../../admission/process.js';

interface SessionOpeningPreparerOptions {
  readonly definitions: SealedAgentRegistry;
  readonly executablePreflight: ExecutablePreflight;
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputTarget: (output: ClaimedInvocationOutput) => SessionOutputPublicationTarget;
}

const fault = (code: AgentFault['code'], message: string): AgentFault => ({
  code,
  message,
  phase: 'session_opening',
  retryable: false,
});

const outputFaultCode = (
  reason: Extract<ProcessAdmissionPreparation, { status: 'output_rejected' }>['reason'],
): AgentFault['code'] => {
  if (reason === 'workspace_invalid') return 'revo.agent.workspace_invalid';
  if (reason === 'output_conflict') return 'revo.agent.output_conflict';
  return 'revo.agent.output_path_invalid';
};

const admissionFault = (
  admission: Exclude<ProcessAdmissionPreparation, { status: 'prepared' }>,
) => {
  if (admission.status === 'cancelled')
    return fault('revo.agent.cancelled', 'Session opening was cancelled.');
  if (admission.status === 'executable_rejected')
    return fault('revo.agent.probe_spawn_failed', 'Agent executable preflight failed.');
  if (admission.status === 'output_rejected')
    return fault(
      outputFaultCode(admission.reason),
      'Session output directory is invalid or unavailable.',
    );
  return fault('revo.agent.output_path_invalid', 'Session output directory is unavailable.');
};

const pinnedDefinition = (
  definitions: SealedAgentRegistry,
  pin: Readonly<{ agentId: string; agentVersion: string; definitionDigest: string }>,
): ValidatedAgentDefinition | undefined => {
  const definition = definitions.get({ id: pin.agentId, version: pin.agentVersion });
  return definition?.digest === pin.definitionDigest ? definition : undefined;
};

export const createSessionOpeningPreparer = (
  options: SessionOpeningPreparerOptions,
): SessionOpeningPreparer => {
  const inputPolicy = EffectiveInvocationInputPolicy.create(options.definitions.list());
  const preparer: SessionOpeningPreparer = {
    prepare: async (opening, { signal }) => {
      const definition = pinnedDefinition(options.definitions, opening.pin);
      if (definition === undefined)
        return {
          fault: fault('revo.agent.continuation_pin_mismatch', 'Session definition pin is stale.'),
          status: 'rejected',
        };
      const request = opening.request.request;
      const inputs = inputPolicy.prepare(definition, request);
      if (inputs.status !== 'prepared')
        return {
          fault: fault(
            inputs.status === 'parameters_invalid'
              ? 'revo.agent.parameters_invalid'
              : 'revo.agent.permissions_invalid',
            'Session inputs do not satisfy the selected definition.',
          ),
          status: 'rejected',
        };
      const args = literalArguments(definition.definition);
      if (args === undefined)
        return {
          fault: fault(
            'revo.agent.strategy_unsupported',
            'Session launch strategy is unsupported.',
          ),
          status: 'rejected',
        };
      const admission = await prepareProcessAdmission({
        definition: definition.definition,
        executablePreflight: options.executablePreflight,
        outputClaimPlatform: options.outputClaimPlatform,
        outputDirectory: request.output.directory,
        signal,
        workspace: request.workspace.directory,
      });
      if (admission.status !== 'prepared')
        return { fault: admissionFault(admission), status: 'rejected' };
      const prepared: PreparedSessionOpening = Object.freeze({
        definition: definition.definition,
        inputs: inputs.inputs,
        launch: Object.freeze({
          args,
          command: admission.launch.executable,
          cwd: request.workspace.directory,
          ...(opening.environment === undefined ? {} : { environment: opening.environment.values }),
        }),
        output: options.outputTarget(admission.output),
      });
      return { status: 'prepared', value: prepared };
    },
  };
  return Object.freeze(preparer);
};
