import type { AgentSessionContinuationEnvelope } from '../../../src/contracts/session/continuation/envelope.js';

const envelope = {
  provider: { data: { sessionId: 'provider-session' }, format: 'acp/v1' },
  schemaVersion: 'agent-session-continuation-envelope/v1',
  usageBaseline: { inputTokens: 1, outputTokens: 2, scope: 'session_cumulative', totalTokens: 3 },
} satisfies AgentSessionContinuationEnvelope;

void envelope;

const invalidEnvelope = {
  provider: { data: {}, format: 'acp/v1' },
  schemaVersion: 'agent-session-continuation-envelope/v1',
  // @ts-expect-error The persisted baseline is always session cumulative.
  usageBaseline: { scope: 'turn' },
} satisfies AgentSessionContinuationEnvelope;

void invalidEnvelope;
