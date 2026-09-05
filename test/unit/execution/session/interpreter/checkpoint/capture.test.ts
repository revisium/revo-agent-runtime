import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { decodeResumeToken } from '../../../../../../src/application/session/boundary/checkpoint/decode.js';
import { createCheckpointCaptureInterpreter } from '../../../../../../src/execution/session/interpreter/checkpoint/capture.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { SessionProtocolContinuation } from '../../../../../../src/protocol/session/model/request.js';
import type { SessionProtocolSession } from '../../../../../../src/protocol/session/port/session.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { registerProtocolSession } from '../../../../../support/session/interpreter/provider.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = { now: () => ({ iso: '2026-09-05T00:00:04.000Z', milliseconds: 4_000 }) };
const digest = { digest: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') };
const pin = { agentId: 'codex', agentVersion: '1', definitionDigest: 'definition-sha256' };
const cursor = { eventId: 'session_01:1:event:4', sequence: 4, streamId: 'stream_01' };

type CaptureEffect = Extract<SessionEffect, { readonly type: 'checkpoint.capture' }>;
function effect(
  kind: 'checkpoint',
  maxBytes?: number,
): Extract<CaptureEffect, { readonly kind: 'checkpoint' }>;
function effect(
  kind: 'hibernate',
  maxBytes?: number,
): Extract<CaptureEffect, { readonly kind: 'hibernate' }>;
function effect(kind: 'checkpoint' | 'hibernate', maxBytes = 4_096): CaptureEffect {
  const common = {
    correlation: { effectId: 'checkpoint-effect', epoch: 1, sessionId: 'session_01' },
    cursor,
    kind,
    maxBytes,
    pin,
    providerResourceId: 'provider-1',
    timeoutMs: 100,
    type: 'checkpoint.capture' as const,
    usageBaseline: { inputTokens: 7, scope: 'session_cumulative' as const, totalTokens: 7 },
  } as const;
  return kind === 'checkpoint'
    ? { ...common, checkpointId: 'checkpoint-1', kind }
    : { ...common, kind, resumeTokenId: 'token-1' };
}

const sessionWithCheckpoint = (
  data: SessionProtocolContinuation['data'],
): SessionProtocolSession => ({
  checkpoint: async () => ({ continuation: { data, format: 'acp/v1' }, status: 'captured' }),
  close: async () => ({ status: 'closed' }),
  prompt: () => {
    throw new Error('Unexpected prompt.');
  },
  respond: async () => ({ status: 'accepted' }),
});

it('captures an immutable hibernation token with the shared envelope and digest', async () => {
  const providerData = { providerSessionId: 'native-session-1' };
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, sessionWithCheckpoint(providerData));
  const recorded = recordingSessionEffectOutput();
  createCheckpointCaptureInterpreter({ clock, digest, resources }).execute(
    effect('hibernate'),
    recorded.output,
  );
  await flushMicrotasks(12);
  providerData.providerSessionId = 'mutated-after-capture';

  const outcome = recorded.outcomes.at(-1);
  expect(outcome?.type).toBe('checkpoint.captured');
  if (outcome?.type !== 'checkpoint.captured' || outcome.kind !== 'hibernate')
    throw new Error('Expected a hibernation token.');
  expect(decodeResumeToken(outcome.resumeToken, pin, digest, 4_096)).toMatchObject({
    envelope: {
      provider: { data: { providerSessionId: 'native-session-1' }, format: 'acp/v1' },
      usageBaseline: { inputTokens: 7, scope: 'session_cumulative', totalTokens: 7 },
    },
    token: { eligibility: 'hibernated', resumeTokenId: 'token-1' },
  });
});

it('emits an observation-only checkpoint that cannot be relabelled as resumable', async () => {
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, sessionWithCheckpoint({ providerSessionId: 'native' }));
  const recorded = recordingSessionEffectOutput();
  createCheckpointCaptureInterpreter({ clock, digest, resources }).execute(
    effect('checkpoint'),
    recorded.output,
  );
  await flushMicrotasks(12);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    checkpoint: { checkpointId: 'checkpoint-1', eligibility: 'observation_only' },
    kind: 'checkpoint',
    type: 'checkpoint.captured',
  });
});

it.each([{ providerSessionId: 'known-secret' }, { credentials: { value: 'anything' } }])(
  'rejects unsafe provider continuation data without leaking it: %o',
  async (data) => {
    const resources = createSessionInterpreterResources();
    registerProtocolSession(resources, sessionWithCheckpoint(data), {
      secrets: { apiKey: 'known-secret' },
    });
    const recorded = recordingSessionEffectOutput();
    createCheckpointCaptureInterpreter({ clock, digest, resources }).execute(
      effect('hibernate'),
      recorded.output,
    );
    await flushMicrotasks(12);
    expect(recorded.outcomes.at(-1)).toMatchObject({
      fault: { code: 'revo.agent.checkpoint_invalid' },
      type: 'checkpoint.failed',
    });
    expect(JSON.stringify(recorded.outcomes)).not.toContain('known-secret');
  },
);

it('rejects a continuation whose canonical envelope exceeds the effect limit', async () => {
  const resources = createSessionInterpreterResources();
  registerProtocolSession(
    resources,
    sessionWithCheckpoint({ providerSessionId: 'native-session-id' }),
  );
  const recorded = recordingSessionEffectOutput();
  createCheckpointCaptureInterpreter({ clock, digest, resources }).execute(
    effect('hibernate', 16),
    recorded.output,
  );
  await flushMicrotasks(12);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.checkpoint_invalid' },
    type: 'checkpoint.failed',
  });
});
