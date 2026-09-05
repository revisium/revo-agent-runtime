import { expect, test } from 'vitest';

import { validateAgentDefinition } from '../../../../../../src/definition/index.js';
import { createOpeningPreparationInterpreter } from '../../../../../../src/execution/session/interpreter/provider/opening/prepare.js';
import { createSessionInterpreterResources } from '../../../../../../src/execution/session/interpreter/provider/opening/resources.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';
import type { SessionOpeningPreparer } from '../../../../../../src/execution/session/port/opening-preparation.js';
import { agentDefinition } from '../../../../../support/builders/agent-definition.js';
import { sessionOpeningCommand } from '../../../../../support/session/builders/kernel/opening.js';
import { recordingSessionEffectOutput } from '../../../../../support/session/interpreter/output.js';
import { flushMicrotasks } from '../../../../../support/session/runtime/scheduling/async-steps.js';

const effect = {
  correlation: { effectId: 'prepare', epoch: 1, sessionId: 'session_01' },
  opening: sessionOpeningCommand().opening,
  timeoutMs: 10,
  type: 'opening.prepare',
} satisfies Extract<SessionEffect, { type: 'opening.prepare' }>;
const prepared = {
  definition: validateAgentDefinition(agentDefinition({ version: '1' })).definition,
  inputs: { parameters: {}, permissions: {} },
  launch: { args: [], command: 'agent', cwd: '/workspace' },
  output: {
    publish: async () => ({
      files: {
        directory: '/output',
        manifest: 'session.json' as const,
        stderr: 'stderr.log' as const,
        stdout: 'stdout.log' as const,
      },
      state: 'published' as const,
    }),
  },
};

const setup = (
  preparer: SessionOpeningPreparer,
  timer?: { schedule(milliseconds: number, callback: () => void): { cancel(): void } },
) => {
  const resources = createSessionInterpreterResources();
  const recorded = recordingSessionEffectOutput();
  const interpreter = createOpeningPreparationInterpreter({
    clock: { now: () => ({ iso: '2026-09-05T00:00:01.000Z', milliseconds: 1_000 }) },
    identities: { next: () => 'preparation-1' },
    preparer,
    resources,
    ...(timer === undefined ? {} : { timer }),
  });
  return { interpreter, recorded, resources };
};

test('ignores unrelated effects and registers a successful preparation', async () => {
  const preparer: SessionOpeningPreparer = {
    prepare: async () => ({ status: 'prepared', value: prepared }),
  };
  const story = setup(preparer);
  story.interpreter.execute({ type: 'other' } as never, story.recorded.output);
  story.interpreter.execute(effect, story.recorded.output);
  await flushMicrotasks(8);
  expect(story.recorded.outcomes).toEqual([
    expect.objectContaining({
      preparationId: 'preparation-1',
      type: 'opening.preparation.succeeded',
    }),
  ]);
  expect(story.resources.preparations.get('preparation-1')).toMatchObject({ prepared });
});

test('preserves a stable admission rejection from the preparer', async () => {
  const fault = {
    code: 'revo.agent.output_conflict' as const,
    message: 'conflict',
    phase: 'session_opening' as const,
    retryable: false,
  };
  const story = setup({ prepare: async () => ({ fault, status: 'rejected' }) });
  story.interpreter.execute(effect, story.recorded.output);
  await flushMicrotasks(8);
  expect(story.recorded.outcomes.at(-1)).toEqual(
    expect.objectContaining({ fault, type: 'opening.preparation.rejected' }),
  );
});

test.each(['throw', 'reject'] as const)('contains preparer %s failure', async (mode) => {
  const preparer: SessionOpeningPreparer = {
    prepare: () => {
      if (mode === 'throw') throw new Error('failed');
      return Promise.reject(new Error('failed'));
    },
  };
  const story = setup(preparer);
  story.interpreter.execute(effect, story.recorded.output);
  await flushMicrotasks(8);
  expect(story.recorded.outcomes.at(-1)).toMatchObject({ type: 'opening.preparation.failed' });
});

test('reports bounded timeout and aborts the preparation signal', async () => {
  let observedSignal: AbortSignal | undefined;
  const timer = {
    schedule: (_milliseconds: number, callback: () => void) => {
      queueMicrotask(callback);
      return { cancel: () => undefined };
    },
  };
  const story = setup(
    {
      prepare: async (_opening, context) => {
        observedSignal = context.signal;
        return new Promise<never>(() => undefined);
      },
    },
    timer,
  );
  story.interpreter.execute(effect, story.recorded.output);
  await flushMicrotasks(16);
  expect(observedSignal?.aborted).toBe(true);
  expect(story.recorded.outcomes.at(-1)).toMatchObject({
    fault: { code: 'revo.agent.timeout' },
    type: 'opening.preparation.timed_out',
  });
});

test('fails when preparation identity is already registered', async () => {
  const story = setup({ prepare: async () => ({ status: 'prepared', value: prepared }) });
  story.resources.preparations.register('preparation-1', {
    correlation: effect.correlation,
    opening: effect.opening,
    output: { writeStderr: () => undefined, writeStdout: () => undefined } as never,
    prepared,
  });
  story.interpreter.execute(effect, story.recorded.output);
  await flushMicrotasks(8);
  expect(story.recorded.outcomes.at(-1)).toMatchObject({ type: 'opening.preparation.failed' });
});
