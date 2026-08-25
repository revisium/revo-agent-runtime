import type {
  AgentInvocationResult,
  AgentInvocationResultBase,
  AgentInvocationFailed,
  AgentOutputFiles,
} from '../spec/index.js';
import { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';
import { buildAgentInvocationResult } from './build-agent-invocation-result.js';
import { createIsoTimestamp } from './create-iso-timestamp.js';
import { mintRawFinalResponseEligibility } from './mint-raw-final-response-eligibility.js';
import type { NormalizedInvocationOutcome } from './normalized-invocation-outcome.js';
import type { TerminalPublicationAuthority } from './output-preparation-attempt/index.js';
import type { TerminalPublicationPort } from './terminal-publication-port/index.js';

const downgrade = (
  outcome: NormalizedInvocationOutcome,
  code: 'revo.agent.scratch_cleanup_failed' | 'revo.agent.output_write_failed',
): NormalizedInvocationOutcome =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({ kind: 'finalization', code }),
    evidence: outcome.evidence,
  });

const tagRawFile = (
  result: AgentInvocationResult,
  rawResponsePublished: boolean,
): AgentInvocationResult => {
  if (result.status !== 'failed' || !rawResponsePublished || result.rawResponse === undefined)
    return result;
  return Object.freeze({
    ...result,
    rawResponse: Object.freeze({ ...result.rawResponse, file: 'raw-final-response.txt' as const }),
    files: Object.freeze({ ...result.files, rawFinalResponse: 'raw-final-response.txt' as const }),
  });
};

const withoutCommittedResultFile = (result: AgentInvocationFailed): AgentInvocationFailed => {
  const files = { ...result.files };
  delete files.result;
  return Object.freeze({ ...result, files: Object.freeze(files) });
};

export const finalizeInvocationOutcome = async (input: {
  readonly output: TerminalPublicationPort;
  readonly authority: TerminalPublicationAuthority;
  readonly invocationToken: object | undefined;
  readonly base: Omit<AgentInvocationResultBase, 'finishedAt' | 'durationMs' | 'exit' | 'files'> & {
    readonly files: AgentOutputFiles;
  };
  readonly normalized: NormalizedInvocationOutcome;
}): Promise<AgentInvocationResult> => {
  const { output, authority, invocationToken, base, normalized } = input;
  const settled = async <Value>(run: () => Promise<Value>, onRejected: Value): Promise<Value> => {
    try {
      return await run();
    } catch {
      return onRejected;
    }
  };

  const scratchCleanupFailed =
    (
      await settled(
        () => output.cleanupScratch(authority),
        Object.freeze({ status: 'failed' as const, reason: 'cleanup_failed' as const }),
      )
    ).status === 'failed';
  const rawBytes =
    normalized.evidence.rawResponse === undefined
      ? undefined
      : BoundedRawResponseEvidence.take(normalized.evidence.rawResponse);
  const eligibility =
    invocationToken === undefined
      ? undefined
      : mintRawFinalResponseEligibility(normalized, invocationToken);

  let rawResponsePublished = false;
  let otherPreResultEvidenceFailed = false;
  if (eligibility !== undefined) {
    const publication = await settled(
      () => output.publishRawResponse(authority, eligibility, rawBytes ?? new Uint8Array(0)),
      Object.freeze({ status: 'write_failed' as const }),
    );
    if (publication.status === 'published') rawResponsePublished = true;
    else otherPreResultEvidenceFailed = true;
  }

  let outcomeAfterPreResult = normalized;
  if (scratchCleanupFailed)
    outcomeAfterPreResult = downgrade(normalized, 'revo.agent.scratch_cleanup_failed');
  else if (otherPreResultEvidenceFailed)
    outcomeAfterPreResult = downgrade(normalized, 'revo.agent.output_write_failed');

  const finishedAt = createIsoTimestamp();
  const richBase = Object.freeze({
    ...base,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(base.acceptedAt),
    exit: Object.freeze({
      code: outcomeAfterPreResult.evidence.exit?.exitCode ?? null,
      signal: outcomeAfterPreResult.evidence.exit?.signal ?? null,
    }),
  });

  const preSubmitCandidate = tagRawFile(
    buildAgentInvocationResult({ base: richBase, outcome: outcomeAfterPreResult }),
    rawResponsePublished,
  );
  const published = await settled(
    () => output.publishTerminalResult(authority, preSubmitCandidate),
    Object.freeze({ status: 'write_failed' as const }),
  );
  if (published.status === 'published') return preSubmitCandidate;

  const outcomeAfterPublish = downgrade(outcomeAfterPreResult, 'revo.agent.output_write_failed');
  const delivered = buildAgentInvocationResult({ base: richBase, outcome: outcomeAfterPublish });
  return delivered.status === 'failed' ? withoutCommittedResultFile(delivered) : delivered;
};
