import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

import { canonicalJsonBytes } from '../../../../support/session/specification/canonical/json-bytes.js';
import { agentSessionPublicContractVectors } from '../../../fixtures/session/public-contract/agent-session-v1.vectors.js';

const fixtureUrl = new URL(
  '../../../fixtures/session/public-contract/agent-session-v1.golden.json',
  import.meta.url,
);
const digestUrl = new URL(
  '../../../fixtures/session/public-contract/agent-session-v1.golden.sha256',
  import.meta.url,
);

describe('session public contract vectors', () => {
  test('cover every closed event and result discriminant', () => {
    expect(new Set(agentSessionPublicContractVectors.events.map(({ type }) => type))).toEqual(
      new Set([
        'session.accepted',
        'session.opened',
        'turn.started',
        'assistant.message.delta',
        'assistant.message.completed',
        'agent.progress',
        'tool.activity',
        'plan.updated',
        'interaction.requested',
        'interaction.resolved',
        'usage.updated',
        'session.checkpointed',
        'turn.completed',
        'session.hibernated',
        'session.closed',
      ]),
    );
    expect(agentSessionPublicContractVectors.turnResults.map(({ status }) => status)).toEqual([
      'completed',
      'cancelled',
      'timed_out',
      'interrupted',
      'failed',
    ]);
    expect(
      agentSessionPublicContractVectors.interactionResponses.map(({ outcome }) => outcome),
    ).toEqual(['selected', 'denied', 'submitted', 'declined', 'cancelled']);
    expect(
      agentSessionPublicContractVectors.events.flatMap((event) =>
        event.type === 'turn.completed' ? [event.outcome.status] : [],
      ),
    ).toEqual(['completed', 'cancelled', 'timed_out', 'interrupted', 'failed']);
    expect(
      agentSessionPublicContractVectors.events.flatMap((event) =>
        event.type === 'session.closed' ? [event.outcome] : [],
      ),
    ).toEqual(['closed', 'cancelled', 'idle_timeout', 'wall_clock_timeout', 'failed']);
    expect(agentSessionPublicContractVectors.terminalRecords.map(({ status }) => status)).toEqual([
      'closed',
      'cancelled',
      'hibernated',
      'failed',
      'timed_out',
    ]);
    expect(
      agentSessionPublicContractVectors.interactionVocabulary.questions.map(({ input }) => input),
    ).toEqual(['text', 'number', 'boolean', 'select', 'select']);
    expect(
      agentSessionPublicContractVectors.capabilities.negotiated.map(({ resume }) => resume),
    ).toEqual(['none', 'native']);
    expect(
      agentSessionPublicContractVectors.vocabulary.sessionFaults.map(({ code }) => code),
    ).toEqual([
      'revo.agent.session_state_unavailable',
      'revo.agent.session_unsupported',
      'revo.agent.session_duplicate',
      'revo.agent.session_unknown',
      'revo.agent.session_closed',
      'revo.agent.session_busy',
      'revo.agent.session_capacity',
      'revo.agent.session_identity_capacity',
      'revo.agent.session_backpressure',
      'revo.agent.turn_duplicate',
      'revo.agent.turn_incomplete',
      'revo.agent.interaction_unknown',
      'revo.agent.interaction_conflict',
      'revo.agent.interaction_invalid',
      'revo.agent.checkpoint_invalid',
      'revo.agent.resume_token_invalid',
      'revo.agent.resume_token_consumed',
      'revo.agent.continuation_pin_mismatch',
      'revo.agent.checkpoint_unsupported',
      'revo.agent.continuation_too_large',
      'revo.agent.event_conflict',
      'revo.agent.event_sink_failed',
      'revo.agent.session_output_too_large',
    ]);
    expect(
      agentSessionPublicContractVectors.vocabulary.sessionFaults
        .filter(({ retryable }) => retryable)
        .map(({ code }) => code),
    ).toEqual([
      'revo.agent.session_busy',
      'revo.agent.session_capacity',
      'revo.agent.session_backpressure',
      'revo.agent.turn_incomplete',
      'revo.agent.event_sink_failed',
    ]);
  });

  test('match the generated canonical bytes and digest', async () => {
    const expectedBytes = canonicalJsonBytes(agentSessionPublicContractVectors);
    const expectedArtifact = Buffer.concat([Buffer.from(expectedBytes), Buffer.from('\n')]);
    const [fixture, digestFile] = await Promise.all([
      readFile(fixtureUrl),
      readFile(digestUrl, 'utf8'),
    ]);
    const expectedDigest = createHash('sha256').update(expectedArtifact).digest('hex');

    expect(fixture).toEqual(expectedArtifact);
    expect(digestFile).toBe(`${expectedDigest}  agent-session-v1.golden.json\n`);
  });
});
