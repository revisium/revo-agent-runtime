import { AgentManagerError, type AgentStartContext } from '../../contracts/manager.js';
import type { CapturedEnvironment } from '../../execution/invocation/environment.js';
import type { ClaimedInvocationOutput, OutputClaimPlatform } from '../../execution/output/claim.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import type {
  EffectiveInvocationInputPolicy,
  EffectiveInvocationInputs,
} from '../admission/effective-inputs.js';
import { prepareProcessAdmission } from '../admission/process.js';
import {
  executablePreflightError,
  fault,
  outputPreflightError,
  preacceptanceError,
} from '../faults/agent-faults.js';
import {
  captureStartEnvironment,
  type PreparedInvocationRequest,
} from '../invocation/preflight.js';

export interface PreparedInvocationStart {
  readonly admission: Readonly<{
    readonly launch: { readonly executable: string; readonly reportedVersion: string };
    readonly output: ClaimedInvocationOutput;
  }>;
  readonly environment: CapturedEnvironment;
  readonly inputs: EffectiveInvocationInputs;
  readonly prepared: PreparedInvocationRequest;
}

interface InvocationStartPreparationServices {
  readonly executablePreflight: ExecutablePreflight;
  readonly inputPolicy: EffectiveInvocationInputPolicy;
  readonly outputClaimPlatform: OutputClaimPlatform;
}

export const prepareInvocationStart = async (
  prepared: PreparedInvocationRequest,
  context: AgentStartContext | undefined,
  signal: AbortSignal,
  services: InvocationStartPreparationServices,
): Promise<PreparedInvocationStart> => {
  const inputPreparation = services.inputPolicy.prepare(prepared.definition, prepared.request);
  if (inputPreparation.status === 'parameters_invalid')
    throw new AgentManagerError(
      fault(
        'revo.agent.parameters_invalid',
        'Agent parameters do not satisfy the selected definition.',
        'preflight',
      ),
    );
  if (inputPreparation.status === 'permissions_invalid')
    throw new AgentManagerError(
      fault(
        'revo.agent.permissions_invalid',
        'Agent permissions do not satisfy the selected definition.',
        'preflight',
      ),
    );
  const environment = captureStartEnvironment(context);
  const admission = await prepareProcessAdmission({
    definition: prepared.definition.definition,
    executablePreflight: services.executablePreflight,
    outputClaimPlatform: services.outputClaimPlatform,
    outputDirectory: prepared.request.output.directory,
    signal,
    workspace: prepared.request.workspace.directory,
  });
  if (admission.status === 'cancelled')
    throw preacceptanceError({ status: 'cancelled' }, 'confirmed');
  if (admission.status === 'output_rejected') throw outputPreflightError(admission.reason);
  if (admission.status === 'output_uncertain') throw outputPreflightError('output_path_invalid');
  if (admission.status === 'executable_rejected')
    throw executablePreflightError(admission.failure.reason);
  return Object.freeze({
    admission,
    environment,
    inputs: inputPreparation.inputs,
    prepared,
  });
};
