import type { AgentDefinition } from '../../contracts/agent-definition.js';
import type { AgentLaunchEvidence } from '../../contracts/manager.js';
import type { ClaimedInvocationOutput, OutputClaimPlatform } from '../../execution/output/claim.js';
import { prepareOutputClaim } from '../../execution/output/claim.js';
import type {
  ExecutablePreflight,
  ExecutablePreflightFailure,
} from '../../execution/probe/executable-preflight.js';

export type InvocationAdmissionPreparation =
  | Readonly<{ readonly status: 'cancelled' }>
  | Readonly<{ readonly status: 'output_uncertain' }>
  | Readonly<{
      readonly status: 'output_rejected';
      readonly reason: 'workspace_invalid' | 'output_path_invalid' | 'output_conflict';
    }>
  | Readonly<{
      readonly status: 'executable_rejected';
      readonly failure: ExecutablePreflightFailure;
    }>
  | Readonly<{
      readonly status: 'prepared';
      readonly output: ClaimedInvocationOutput;
      readonly launch: AgentLaunchEvidence;
    }>;

export const prepareInvocationAdmission = async (input: {
  readonly definition: AgentDefinition;
  readonly executablePreflight: ExecutablePreflight;
  readonly outputClaimPlatform: OutputClaimPlatform;
  readonly outputDirectory: string;
  readonly signal: AbortSignal;
  readonly workspace: string;
}): Promise<InvocationAdmissionPreparation> => {
  const output = await prepareOutputClaim(input.outputClaimPlatform, {
    outputDirectory: input.outputDirectory,
    workspace: input.workspace,
  });
  if (output.status === 'rejected')
    return Object.freeze({ reason: output.reason, status: 'output_rejected' });
  if (output.status === 'uncertain') return Object.freeze({ status: 'output_uncertain' });
  if (input.signal.aborted) return Object.freeze({ status: 'cancelled' });

  const executable = await input.executablePreflight.probe(input.definition, input.signal);
  if (executable.status === 'aborted') return Object.freeze({ status: 'cancelled' });
  if (executable.status === 'rejected')
    return Object.freeze({ failure: executable, status: 'executable_rejected' });
  if (input.signal.aborted) return Object.freeze({ status: 'cancelled' });

  const claimed = await output.output.claim();
  if (claimed.status === 'rejected')
    return Object.freeze({ reason: claimed.reason, status: 'output_rejected' });
  if (claimed.status === 'uncertain') return Object.freeze({ status: 'output_uncertain' });
  if (input.signal.aborted) return Object.freeze({ status: 'cancelled' });
  return Object.freeze({
    launch: executable.launch,
    output: claimed.output,
    status: 'prepared',
  });
};
