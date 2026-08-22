import type {
  AgentInvocationResult,
  AgentInvocationResultBase,
  AgentOutputFiles,
} from '../spec/index.js';
import { BoundedRawResponseEvidence } from './bounded-raw-response-evidence.js';
import { buildAgentInvocationResult } from './build-agent-invocation-result.js';
import type { FinalizedInvocationSettlement } from './finalized-invocation-settlement.js';
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

export const finalizeInvocationOutcome = async (input: {
  readonly output: TerminalPublicationPort;
  readonly authority: TerminalPublicationAuthority;
  readonly invocationToken: object | undefined;
  readonly base: Omit<AgentInvocationResultBase, 'finishedAt' | 'durationMs' | 'exit' | 'files'> & {
    readonly files: AgentOutputFiles;
  };
  readonly normalized: NormalizedInvocationOutcome;
}): Promise<FinalizedInvocationSettlement> => {
  const { output, authority, invocationToken, base, normalized } = input;

  const scratchCleanupFailed = (await output.cleanupScratch(authority)).status === 'failed';
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
    const publication = await output.publishRawResponse(
      authority,
      eligibility,
      rawBytes ?? new Uint8Array(0),
    );
    if (publication.status === 'published') rawResponsePublished = true;
    else otherPreResultEvidenceFailed = true;
  }

  let outcomeAfterPreResult = normalized;
  if (scratchCleanupFailed)
    outcomeAfterPreResult = downgrade(normalized, 'revo.agent.scratch_cleanup_failed');
  else if (otherPreResultEvidenceFailed)
    outcomeAfterPreResult = downgrade(normalized, 'revo.agent.output_write_failed');

  const finishedAt = new Date().toISOString();
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
  const published = await output.publishTerminalResult(authority, preSubmitCandidate);
  if (published.status === 'published')
    return Object.freeze({ outcome: outcomeAfterPreResult, delivered: preSubmitCandidate });

  const outcomeAfterPublish = downgrade(outcomeAfterPreResult, 'revo.agent.output_write_failed');
  const delivered = buildAgentInvocationResult({ base: richBase, outcome: outcomeAfterPublish });
  return Object.freeze({ outcome: outcomeAfterPublish, delivered });
};
