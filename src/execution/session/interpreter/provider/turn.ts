import type { JsonObject } from '../../../../contracts/agent-definition.js';
import type { SessionProtocolPromptOutcome } from '../../../../protocol/session/model/outcome.js';
import type { SessionProtocolPrompt } from '../../../../protocol/session/port/session.js';
import type { Sha256Digest } from '../../../security/digest/port.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import { SessionMessageStream } from '../event/message-stream.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';
import { settleOperation } from '../shared/operation/settlement.js';
import {
  systemSessionOperationTimer,
  type SessionOperationTimer,
} from '../shared/operation/timer.js';
import { protocolFault } from './fault.js';
import type { SessionInterpreterResources } from './opening/resources.js';
import {
  publishMessageCompletion,
  publishTurnUpdate,
  publishTurnUsage,
  type TurnUpdateContext,
} from './turn/updates.js';

type PromptEffect = Extract<SessionEffect, { readonly type: 'provider.prompt' }>;

interface TurnOptions {
  readonly clock: SessionObservationClock;
  readonly digest: Sha256Digest;
  readonly resources: SessionInterpreterResources;
  readonly timer?: SessionOperationTimer;
}

const observed = (options: TurnOptions) => {
  const now = options.clock.now();
  return { observedAt: now.iso, observedAtMs: now.milliseconds } as const;
};

const requestCancellation = (prompt: SessionProtocolPrompt, reason: string): void => {
  try {
    void prompt.cancel(reason).catch(() => undefined);
  } catch {
    // Prompt completion or the bounded timeout still determines the turn outcome.
  }
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const createProviderTurnInterpreter = (
  options: TurnOptions,
): SessionEffectHandler<'provider.prompt'> => ({
  type: 'provider.prompt',
  execute: (candidate, output): void => {
    if (candidate.type !== 'provider.prompt') return;
    void promptProvider(candidate, output, options);
  },
});

const promptProvider = async (
  effect: PromptEffect,
  output: SessionEffectOutput,
  options: TurnOptions,
): Promise<void> => {
  const provider = options.resources.providers.get(effect.providerResourceId);
  if (provider === undefined) return emitFailure(effect, output, options);
  const limits = provider.preparation.opening.limits;
  const context: TurnUpdateContext = {
    clock: options.clock,
    completedMessage: false,
    effect,
    output,
    provider,
    stream: new SessionMessageStream({
      digest: options.digest,
      maxChunkBytes: Math.max(4, Math.floor(limits.maxEventBytes / 2)),
      maxMessageBytes: limits.maxMessageBytes,
      secrets: Object.values(provider.preparation.opening.environment?.secrets ?? {}),
    }),
  };
  let prompt;
  try {
    if (effect.input.metadata !== undefined && !isJsonObject(effect.input.metadata))
      throw new TypeError('Prompt metadata must be a JSON object.');
    prompt = provider.session.prompt({
      ...(effect.input.metadata === undefined ? {} : { metadata: effect.input.metadata }),
      observer: { update: (value) => publishTurnUpdate(context, value) },
      prompt: effect.input.prompt,
    });
  } catch {
    emitFailure(effect, output, options);
    return;
  }
  if (
    !options.resources.prompts.register(effect.providerResourceId, effect.input.turnId, {
      effectId: effect.correlation.effectId,
      prompt,
    })
  ) {
    requestCancellation(prompt, 'Duplicate provider turn.');
    emitFailure(effect, output, options);
    return;
  }
  output.outcome({
    ...observed(options),
    correlation: effect.correlation,
    type: 'provider.prompt.accepted',
  });
  const settlement = await settleOperation({
    onTimeout: () => requestCancellation(prompt, 'Provider prompt timed out.'),
    operation: prompt.completion,
    timeoutMs: effect.timeoutMs,
    timer: options.timer ?? systemSessionOperationTimer,
  });
  options.resources.prompts.take(
    effect.providerResourceId,
    effect.input.turnId,
    effect.correlation.effectId,
  );
  if (settlement.state !== 'fulfilled' || settlement.phase !== 'initial') {
    emitFailure(effect, output, options, true);
    return;
  }
  await emitCompletion(context, settlement.value, options);
};

const emitCompletion = async (
  context: TurnUpdateContext,
  outcome: SessionProtocolPromptOutcome,
  options: TurnOptions,
): Promise<void> => {
  if (outcome.status === 'completed') {
    await publishMessageCompletion(context);
    const usage =
      outcome.usage === undefined ? undefined : await publishTurnUsage(context, outcome.usage);
    context.output.outcome({
      ...observed(options),
      correlation: context.effect.correlation,
      outcome: { status: 'completed', ...(usage === undefined ? {} : { usage }) },
      type: 'provider.prompt.completed',
    });
    return;
  }
  if (outcome.status !== 'failed') {
    context.output.outcome({
      ...observed(options),
      correlation: context.effect.correlation,
      outcome: { status: outcome.status },
      type: 'provider.prompt.completed',
    });
    return;
  }
  emitFailure(context.effect, context.output, options, false, outcome.failure);
};

const emitFailure = (
  effect: PromptEffect,
  output: SessionEffectOutput,
  options: TurnOptions,
  timedOut = false,
  failure?: Parameters<typeof protocolFault>[0],
): void => {
  output.outcome({
    ...observed(options),
    correlation: effect.correlation,
    fault: timedOut
      ? {
          code: 'revo.agent.timeout',
          message: 'Provider prompt timed out.',
          phase: 'session_running',
          retryable: false,
        }
      : protocolFault(failure, 'session_running'),
    type: timedOut ? 'provider.prompt.timed_out' : 'provider.prompt.failed',
  });
};
