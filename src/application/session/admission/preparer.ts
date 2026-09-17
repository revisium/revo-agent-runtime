import type { AgentFault } from '../../../contracts/manager/core.js';
import type { SealedAgentRegistry, ValidatedAgentDefinition } from '../../../definition/index.js';
import {
  readInstructionsContinuation,
  type StoredInstructions,
} from '../../../execution/instructions/continuation.js';
import {
  resumedInstructionsDelivery,
  type InstructionsDeliveryResolver,
} from '../../../execution/instructions/delivery.js';
import { prepareInstructionsDelivery } from '../../../execution/instructions/prepare.js';
import type { OutputArtifactPlatform } from '../../../execution/output/artifact.js';
import type {
  ClaimedInvocationOutput,
  OutputClaimPlatform,
} from '../../../execution/output/claim.js';
import type { SessionOutputPublicationTarget } from '../../../execution/output/session/publication.js';
import type { ExecutablePreflight } from '../../../execution/probe/executable-preflight.js';
import { launchEnvironment } from '../../../execution/process/launch-environment.js';
import { literalArguments } from '../../../execution/process/literal-launch.js';
import type { Sha256Digest } from '../../../execution/security/digest/port.js';
import type {
  PreparedSessionInstructions,
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
  readonly digest: Sha256Digest;
  readonly executablePreflight: ExecutablePreflight;
  readonly instructionsDelivery: InstructionsDeliveryResolver;
  readonly outputArtifactPlatform: OutputArtifactPlatform;
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputTarget: (output: ClaimedInvocationOutput) => SessionOutputPublicationTarget;
}

type Rejected = { readonly status: 'rejected'; readonly fault: AgentFault };
type SessionOpeningDescriptor = Parameters<SessionOpeningPreparer['prepare']>[0];

const encoder = new TextEncoder();

const fault = (code: AgentFault['code'], message: string): AgentFault => ({
  code,
  message,
  phase: 'session_opening',
  retryable: false,
});

const rejected = (code: AgentFault['code'], message: string): Rejected => ({
  fault: fault(code, message),
  status: 'rejected',
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

/**
 * The opening boundary already proved the resumed instructions match; the stored channel
 * facts decide whether a native channel may continue and whether a prefix was dispatched.
 */
const storedInstructionsFor = (
  opening: SessionOpeningDescriptor,
): { readonly status: 'read'; readonly value: StoredInstructions | undefined } | Rejected => {
  if (opening.request.kind !== 'resume') return { status: 'read', value: undefined };
  const continuation = readInstructionsContinuation(opening.request.continuation.data);
  if (continuation.status === 'invalid')
    return rejected('revo.agent.checkpoint_invalid', 'Checkpointed instructions are invalid.');
  return {
    status: 'read',
    value: continuation.status === 'stored' ? continuation.value : undefined,
  };
};

interface InstructionsPreparationInput {
  readonly stored: StoredInstructions | undefined;
  readonly definition: ValidatedAgentDefinition;
  readonly digest: string;
  readonly environmentNames: readonly string[];
  readonly opening: SessionOpeningDescriptor;
  readonly reportedVersion: string;
  readonly text: string;
}

const prepareSessionInstructions = async (
  options: SessionOpeningPreparerOptions,
  input: InstructionsPreparationInput,
): Promise<
  { readonly status: 'prepared'; readonly value: PreparedSessionInstructions } | Rejected
> => {
  const stored = input.stored;
  const preparation = await prepareInstructionsDelivery({
    ...(stored === undefined
      ? {}
      : { adjust: (plan) => resumedInstructionsDelivery(plan, stored.mode) }),
    artifacts: options.outputArtifactPlatform,
    request: {
      definitionId: input.definition.definition.id,
      definitionVersion: input.definition.definition.version,
      environmentNames: input.environmentNames,
      instructions: input.text,
      outputDirectory: input.opening.request.request.output.directory,
      reportedVersion: input.reportedVersion,
    },
    resolve: options.instructionsDelivery,
  });
  if (preparation.status !== 'prepared')
    return rejected('revo.agent.output_write_failed', 'Instructions file could not be created.');
  return {
    status: 'prepared',
    value: {
      ...preparation.value,
      digest: input.digest,
      dispatched: stored?.mode === 'prompt_prefix' ? stored.dispatched : false,
    },
  };
};

export const createSessionOpeningPreparer = (
  options: SessionOpeningPreparerOptions,
): SessionOpeningPreparer => {
  const inputPolicy = EffectiveInvocationInputPolicy.create(options.definitions.list());
  const preparer: SessionOpeningPreparer = {
    prepare: async (opening, { signal }) => {
      const definition = pinnedDefinition(options.definitions, opening.pin);
      if (definition === undefined)
        return rejected('revo.agent.continuation_pin_mismatch', 'Session definition pin is stale.');
      const request = opening.request.request;
      const inputs = inputPolicy.prepare(definition, request);
      if (inputs.status !== 'prepared')
        return rejected(
          inputs.status === 'parameters_invalid'
            ? 'revo.agent.parameters_invalid'
            : 'revo.agent.permissions_invalid',
          'Session inputs do not satisfy the selected definition.',
        );
      const args = literalArguments(definition.definition);
      if (args === undefined)
        return rejected(
          'revo.agent.strategy_unsupported',
          'Session launch strategy is unsupported.',
        );
      const stored = storedInstructionsFor(opening);
      if (stored.status === 'rejected') return stored;
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
      const environment = launchEnvironment(definition.definition, opening.environment?.values);
      const text = request.instructions;
      const instructions =
        text === undefined
          ? undefined
          : await prepareSessionInstructions(options, {
              definition,
              digest: options.digest.digest(encoder.encode(text)),
              environmentNames: Object.keys(environment),
              opening,
              reportedVersion: admission.launch.reportedVersion,
              stored: stored.value,
              text,
            });
      if (instructions?.status === 'rejected') return instructions;
      const prepared: PreparedSessionOpening = Object.freeze({
        definition: definition.definition,
        inputs: inputs.inputs,
        ...(instructions === undefined ? {} : { instructions: instructions.value }),
        ...(opening.mcpServers === undefined ? {} : { mcpServers: opening.mcpServers }),
        launch: Object.freeze({
          args,
          command: admission.launch.executable,
          cwd: request.workspace.directory,
          environment: Object.freeze({ ...environment, ...instructions?.value.environment }),
        }),
        output: options.outputTarget(admission.output),
      });
      return { status: 'prepared', value: prepared };
    },
  };
  return Object.freeze(preparer);
};
