import type { AgentMcpServer } from '../../contracts/context.js';
import type { AgentLaunchEvidence } from '../../contracts/launch.js';
import { AgentManagerError, type AgentStartContext } from '../../contracts/manager.js';
import type { InstructionsDeliveryResolver } from '../../execution/instructions/delivery.js';
import {
  prepareInstructionsDelivery,
  type PreparedInstructions,
} from '../../execution/instructions/prepare.js';
import type { CapturedEnvironment } from '../../execution/invocation/environment.js';
import { resolveMcpServers } from '../../execution/mcp/servers.js';
import type { OutputArtifactPlatform } from '../../execution/output/artifact.js';
import type { ClaimedInvocationOutput, OutputClaimPlatform } from '../../execution/output/claim.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import { launchEnvironment } from '../../execution/process/launch-environment.js';
import { literalArguments } from '../../execution/process/literal-launch.js';
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
    readonly launch: AgentLaunchEvidence;
    readonly output: ClaimedInvocationOutput;
  }>;
  readonly environment: CapturedEnvironment;
  readonly inputs: EffectiveInvocationInputs;
  readonly instructions?: PreparedInstructions;
  readonly mcpServers?: readonly AgentMcpServer[];
  readonly prepared: PreparedInvocationRequest;
}

interface InvocationStartPreparationServices {
  readonly executablePreflight: ExecutablePreflight;
  readonly inputPolicy: EffectiveInvocationInputPolicy;
  readonly instructionsDelivery: InstructionsDeliveryResolver;
  readonly outputArtifactPlatform: OutputArtifactPlatform;
  readonly outputClaimPlatform: OutputClaimPlatform;
}

const preflightError = (
  code: 'revo.agent.parameters_invalid' | 'revo.agent.output_write_failed',
  message: string,
) => new AgentManagerError(fault(code, message, 'preflight'));

const resolveInvocationMcpServers = (
  prepared: PreparedInvocationRequest,
  environment: CapturedEnvironment,
): readonly AgentMcpServer[] | undefined => {
  try {
    return resolveMcpServers(prepared.request.mcpServers, environment.values);
  } catch {
    throw preflightError(
      'revo.agent.parameters_invalid',
      'MCP environment binding is unavailable.',
    );
  }
};

/** The channel is decided once after preflight and output claim; a failed native file never falls back. */
const prepareInvocationInstructions = async (
  prepared: PreparedInvocationRequest,
  launch: AgentLaunchEvidence,
  environment: CapturedEnvironment,
  services: InvocationStartPreparationServices,
): Promise<PreparedInstructions | undefined> => {
  const text = prepared.request.instructions;
  if (text === undefined) return undefined;
  const definition = prepared.definition.definition;
  const preparation = await prepareInstructionsDelivery({
    artifacts: services.outputArtifactPlatform,
    request: {
      definitionId: definition.id,
      definitionVersion: definition.version,
      environmentNames: Object.keys(launchEnvironment(definition, environment.values)),
      instructions: text,
      outputDirectory: prepared.request.output.directory,
      reportedVersion: launch.reportedVersion,
    },
    resolve: services.instructionsDelivery,
  });
  if (preparation.status !== 'prepared')
    throw preflightError(
      'revo.agent.output_write_failed',
      'Instructions file could not be created.',
    );
  return preparation.value;
};

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
  if (literalArguments(prepared.definition.definition) === undefined)
    throw new AgentManagerError(
      fault(
        'revo.agent.strategy_unsupported',
        'Agent launch strategy is unsupported.',
        'preflight',
      ),
    );
  const environment = captureStartEnvironment(context);
  const mcpServers = resolveInvocationMcpServers(prepared, environment);
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
  const instructions = await prepareInvocationInstructions(
    prepared,
    admission.launch,
    environment,
    services,
  );
  return Object.freeze({
    admission,
    environment,
    inputs: inputPreparation.inputs,
    ...(instructions === undefined ? {} : { instructions }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
    prepared,
  });
};
