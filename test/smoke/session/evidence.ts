import type { AgentSessionTurnResult } from '../../../src/index.js';

export interface SessionContinuityEvidence {
  readonly cleanup: 'confirmed';
  readonly eventCount: number;
  readonly nonceMatched: boolean;
  readonly providerId: string;
  readonly resume: 'passed' | 'unsupported';
  readonly turnStatuses: readonly AgentSessionTurnResult['status'][];
}

export interface SessionCancellationEvidence {
  readonly cleanup: 'confirmed';
  readonly eventCount: number;
  readonly providerId: string;
  readonly status: AgentSessionTurnResult['status'];
}

export interface SessionInteractionEvidence {
  readonly cleanup: 'confirmed';
  readonly eventCount: number;
  readonly interactionKinds: readonly ['permission', 'input'];
  readonly providerId: string;
  readonly resolvedCount: number;
  readonly status: AgentSessionTurnResult['status'];
}

export type SessionSmokeEvidence =
  | SessionContinuityEvidence
  | SessionCancellationEvidence
  | SessionInteractionEvidence;

export const formatSessionSmokeEvidence = (evidence: SessionSmokeEvidence): string =>
  'turnStatuses' in evidence
    ? [
        `${evidence.providerId}: turns=${evidence.turnStatuses.join(',')}`,
        `events=${evidence.eventCount}`,
        `nonceMatched=${evidence.nonceMatched}`,
        `cleanup=${evidence.cleanup}`,
        `resume=${evidence.resume}`,
      ].join('; ')
    : 'interactionKinds' in evidence
      ? [
          `${evidence.providerId}-interactions: status=${evidence.status}`,
          `requests=${evidence.interactionKinds.join(',')}`,
          `resolved=${evidence.resolvedCount}`,
          `events=${evidence.eventCount}`,
          `cleanup=${evidence.cleanup}`,
        ].join('; ')
      : [
          `${evidence.providerId}-cancel: status=${evidence.status}`,
          `events=${evidence.eventCount}`,
          `cleanup=${evidence.cleanup}`,
        ].join('; ');
