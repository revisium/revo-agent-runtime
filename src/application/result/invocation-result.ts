import type {
  AgentExecutionPin,
  AgentInvocationResult,
  AgentOutputFiles,
  StartAgentInvocation,
} from '../../contracts/manager.js';
import type { ExecutionEvidence, ExecutionOutcome } from '../../execution/invocation/executor.js';
import {
  snapshotPlainJsonObject,
  type PlainJsonObject,
} from '../../execution/output/plain-json-snapshot.js';
import {
  cancellationFailure,
  executionFailure,
  protocolFailure,
  timeoutFailure,
} from '../faults/agent-faults.js';

export interface InvocationResultTiming {
  readonly acceptedAt: string;
  readonly finishedAt: string;
  readonly startedAt?: string;
}

const ownedValue = (value: unknown): PlainJsonObject => snapshotPlainJsonObject(value, 1_048_576);

const durationBetween = (acceptedAt: string, finishedAt: string): number => {
  const accepted = Date.parse(acceptedAt);
  const finished = Date.parse(finishedAt);
  const duration = finished - accepted;
  if (!Number.isSafeInteger(duration) || duration < 0)
    throw new Error('Invalid invocation timing.');
  return duration;
};

const baseResult = (
  request: StartAgentInvocation,
  pin: AgentExecutionPin,
  outcome: ExecutionOutcome,
  evidence: ExecutionEvidence,
  timing: InvocationResultTiming,
) =>
  Object.freeze({
    acceptedAt: timing.acceptedAt,
    durationMs: durationBetween(timing.acceptedAt, timing.finishedAt),
    exit: Object.freeze({
      code: evidence.processExit.exitCode,
      signal: evidence.processExit.signal,
    }),
    finishedAt: timing.finishedAt,
    invocationId: request.invocationId,
    launch: Object.freeze({ ...evidence.launch }),
    ...(request.metadata === undefined ? {} : { metadata: ownedValue(request.metadata) }),
    pin,
    schemaVersion: 'agent-invocation-result/v1' as const,
    ...(timing.startedAt === undefined ? {} : { startedAt: timing.startedAt }),
    ...(outcome.usage === undefined ? {} : { usage: Object.freeze({ ...outcome.usage }) }),
  });

type InvocationResultBase = ReturnType<typeof baseResult>;

interface ResultPublication {
  readonly committed: boolean;
  readonly rawPublished: boolean;
}

const defaultResultPublication = Object.freeze({ committed: true, rawPublished: true });

const outputFiles = (
  request: StartAgentInvocation,
  outcome: ExecutionOutcome,
  publication: ResultPublication,
): AgentOutputFiles =>
  Object.freeze({
    directory: request.output.directory,
    events: 'events.ndjson',
    stdout: 'stdout.log',
    stderr: 'stderr.log',
    ...(publication.rawPublished && outcome.status === 'failed' && outcome.evidence !== undefined
      ? { rawFinalResponse: 'raw-final-response.txt' as const }
      : {}),
  });

const withCommittedResult = (files: AgentOutputFiles) =>
  Object.freeze({ ...files, result: 'result.json' as const });

const withOptionalResult = (files: AgentOutputFiles, committed: boolean): AgentOutputFiles =>
  Object.freeze({ ...files, ...(committed ? { result: 'result.json' as const } : {}) });

const normalizedResult = (
  base: InvocationResultBase,
  request: StartAgentInvocation,
  outcome: ExecutionOutcome,
  publication: ResultPublication,
): AgentInvocationResult => {
  const files = outputFiles(request, outcome, publication);
  const committedFiles = withCommittedResult(files);
  if (outcome.status === 'succeeded')
    return Object.freeze({
      ...base,
      files: committedFiles,
      status: 'succeeded',
      value: ownedValue(outcome.value),
    });
  if (outcome.status === 'cancelled')
    return Object.freeze({
      ...base,
      error: cancellationFailure(),
      files: committedFiles,
      status: 'cancelled',
    });
  if (outcome.status === 'timed_out')
    return Object.freeze({
      ...base,
      error: timeoutFailure(),
      files: committedFiles,
      status: 'timed_out',
    });
  return Object.freeze({
    ...base,
    error: executionFailure(outcome.code),
    files: withOptionalResult(files, publication.committed),
    status: 'failed',
    ...(!publication.rawPublished || outcome.evidence === undefined
      ? {}
      : {
          rawResponse: Object.freeze({
            ...outcome.evidence.diagnostic,
            file: 'raw-final-response.txt' as const,
          }),
        }),
  });
};

const invalidResult = (
  base: InvocationResultBase,
  request: StartAgentInvocation,
): AgentInvocationResult =>
  Object.freeze({
    ...base,
    error: protocolFailure(),
    files: Object.freeze({
      directory: request.output.directory,
      events: 'events.ndjson' as const,
      stderr: 'stderr.log' as const,
      stdout: 'stdout.log' as const,
    }),
    status: 'failed' as const,
  });

export const buildInvocationResult = (
  request: StartAgentInvocation,
  pin: AgentExecutionPin,
  outcome: ExecutionOutcome,
  evidence: ExecutionEvidence,
  timing: InvocationResultTiming,
  publication: ResultPublication = defaultResultPublication,
): AgentInvocationResult => {
  const base = baseResult(request, pin, outcome, evidence, timing);
  try {
    return normalizedResult(base, request, outcome, publication);
  } catch {
    return invalidResult(base, request);
  }
};
