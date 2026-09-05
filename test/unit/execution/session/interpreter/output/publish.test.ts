import { expect, it, vi } from 'vitest';

import type { SessionOutputPublicationTarget } from '../../../../../../src/execution/output/session/publication.js';
import { createOutputPublicationInterpreter } from '../../../../../../src/execution/session/interpreter/output/publish.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import type { SessionProtocolSession } from '../../../../../../src/protocol/session/port/session.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { registerProtocolSession } from '../../../../../support/session/interpreter/provider.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const clock = { now: () => ({ iso: '2026-09-05T00:00:06.000Z', milliseconds: 6_000 }) };
const session: SessionProtocolSession = {
  checkpoint: async () => ({
    continuation: { data: { providerSessionId: 'native' }, format: 'acp/v1' },
    status: 'captured',
  }),
  close: async () => ({ status: 'closed' }),
  prompt: () => {
    throw new Error('Unexpected prompt.');
  },
  respond: async () => ({ status: 'accepted' }),
};
const effect = {
  correlation: { effectId: 'publish', epoch: 1, sessionId: 'session_01' },
  maxBytes: 4_096,
  outputDirectory: '/output',
  publication: {
    acceptedAt: '2026-09-05T00:00:00.000Z',
    finishedAt: '2026-09-05T00:00:06.000Z',
    pin: { agentId: 'codex', agentVersion: '1', definitionDigest: 'digest' },
    sessionId: 'session_01',
    status: 'closed' as const,
  },
  type: 'output.publish' as const,
};

it('finalizes redacted output and publishes it exactly once', async () => {
  const publish = vi.fn<SessionOutputPublicationTarget['publish']>(async (input) => {
    expect(new TextDecoder().decode(input.stdout)).toBe('key=[REDACTED]');
    expect(new TextDecoder().decode(input.stderr)).toBe('warning');
    return {
      files: {
        directory: '/output',
        manifest: 'session.json',
        stderr: 'stderr.log',
        stdout: 'stdout.log',
      },
      state: 'published',
    };
  });
  const resources = createSessionInterpreterResources();
  const preparation = registerProtocolSession(resources, session, {
    output: { publish },
    secrets: { key: 'secret' },
  });
  preparation.output.writeStdout(new TextEncoder().encode('key=secret'));
  preparation.output.writeStderr(new TextEncoder().encode('warning'));
  const recorded = recordingSessionEffectOutput();
  const interpreter = createOutputPublicationInterpreter({ clock, resources });
  interpreter.execute(effect, recorded.output);
  interpreter.execute(effect, recorded.output);
  interpreter.execute(
    { ...effect, correlation: { ...effect.correlation, effectId: 'duplicate-publication' } },
    recorded.output,
  );
  await flushMicrotasks(12);

  expect(publish).toHaveBeenCalledTimes(1);
  expect(recorded.outcomes).toEqual([
    expect.objectContaining({
      type: 'output.failed',
      correlation: expect.objectContaining({ effectId: 'duplicate-publication' }),
    }),
    expect.objectContaining({ type: 'output.published' }),
  ]);
});

it('classifies a thrown publication as uncertain', async () => {
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session, {
    output: {
      publish: async () => {
        throw new Error('maybe committed');
      },
    },
  });
  const recorded = recordingSessionEffectOutput();
  createOutputPublicationInterpreter({ clock, resources }).execute(effect, recorded.output);
  await flushMicrotasks(12);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    output: { error: { code: 'revo.agent.output_write_failed' }, state: 'uncertain' },
    type: 'output.uncertain',
  });
});

it('fails without calling a target when no preparation owns the session', async () => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  createOutputPublicationInterpreter({ clock, resources }).execute(effect, recorded.output);
  await flushMicrotasks(4);
  expect(recorded.outcomes.at(-1)).toMatchObject({
    output: { state: 'failed' },
    type: 'output.failed',
  });
});

it('fails when collected output exceeds the effect budget', async () => {
  const publish = vi.fn<SessionOutputPublicationTarget['publish']>();
  const resources = createSessionInterpreterResources();
  const preparation = registerProtocolSession(resources, session, { output: { publish } });
  preparation.output.writeStdout(new TextEncoder().encode('large'));
  const recorded = recordingSessionEffectOutput();
  createOutputPublicationInterpreter({ clock, resources }).execute(
    { ...effect, maxBytes: 1 },
    recorded.output,
  );
  await flushMicrotasks(8);
  expect(publish).not.toHaveBeenCalled();
  expect(recorded.outcomes.at(-1)?.type).toBe('output.failed');
});

it.each(['failed', 'uncertain'] as const)('preserves a target %s publication', async (state) => {
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session, {
    output: {
      publish: async () => ({
        error: {
          code: 'revo.agent.output_write_failed',
          message: 'failed',
          phase: 'session_terminal',
          retryable: false,
        },
        files: { directory: '/output', stdout: 'stdout.log' },
        state,
      }),
    },
  });
  const recorded = recordingSessionEffectOutput();
  createOutputPublicationInterpreter({ clock, resources }).execute(effect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)).toMatchObject({ output: { state }, type: `output.${state}` });
});

it('rejects a publication for a different output directory', async () => {
  const resources = createSessionInterpreterResources();
  registerProtocolSession(resources, session, {
    output: {
      publish: async () => ({
        files: {
          directory: '/other',
          manifest: 'session.json',
          stderr: 'stderr.log',
          stdout: 'stdout.log',
        },
        state: 'published',
      }),
    },
  });
  const recorded = recordingSessionEffectOutput();
  createOutputPublicationInterpreter({ clock, resources }).execute(effect, recorded.output);
  await flushMicrotasks(8);
  expect(recorded.outcomes.at(-1)?.type).toBe('output.failed');
});

it('ignores an effect owned by another interpreter', async () => {
  const recorded = recordingSessionEffectOutput();
  createOutputPublicationInterpreter({
    clock,
    resources: createSessionInterpreterResources(),
  }).execute({ ...effect, type: 'process.cleanup' } as never, recorded.output);
  await flushMicrotasks(4);
  expect(recorded.outcomes).toEqual([]);
});
