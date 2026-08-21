import type { InvocationTerminalObservation } from './execution-terminal-observation.js';
import type { InvocationInputSnapshot } from './input-snapshot.js';
import type { InvocationClockPort } from './invocation-clock-port.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import type { OutputClaimExclusiveCreatePort } from './output-claim-attempt/index.js';
import type {
  OutputPreparationMutationPort,
  takePreparedInvocationResourcesPayload,
} from './output-preparation-attempt/index.js';
import type { PreparedLaunch } from './prepared-launch.js';
import type { WorkspaceAdmissionResult } from './workspace-admission-result.js';

type PreparedInvocationResourcesPayload = NonNullable<
  ReturnType<typeof takePreparedInvocationResourcesPayload>
>;

export interface InvocationExecutionPorts {
  readonly execution: {
    start(
      snapshot: InvocationInputSnapshot,
      preparedLaunch: PreparedLaunch,
      resources?: PreparedInvocationResourcesPayload,
    ): Promise<{
      readonly completion: Promise<InvocationTerminalObservation>;
      requestCancellation(): Promise<void>;
    }>;
  };
  readonly workspace: {
    admit(path: string): Promise<WorkspaceAdmissionResult>;
  };
  readonly clock: InvocationClockPort;
  readonly outputClaim: OutputClaimExclusiveCreatePort;
  readonly outputPreparation: OutputPreparationMutationPort;
  readonly output: {
    admit(
      request: Readonly<{
        invocationId: string;
        outputDirectory: string;
        needsPromptFile: boolean;
        needsResultSchemaFile: boolean;
      }>,
    ): Promise<
      | Readonly<{
          status: 'admitted';
          plan: Readonly<{
            invocationId: string;
            outputDirectory: string;
            needsPromptFile: boolean;
            needsResultSchemaFile: boolean;
          }>;
        }>
      | Readonly<{
          status: 'rejected';
          reason:
            | 'unsupported_platform'
            | 'invalid_path'
            | 'missing_parent'
            | 'parent_not_directory'
            | 'leaf_exists'
            | 'inspection_failed';
        }>
    >;
    recordTerminalResult(outcome: NormalizedInvocationOutcome): Promise<void>;
    recordEvent(): Promise<void>;
  };
}
