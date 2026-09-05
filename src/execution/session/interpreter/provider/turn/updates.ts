import type { AgentSessionUsage } from '../../../../../contracts/session/lifecycle/result.js';
import type { SessionProtocolUpdate } from '../../../../../protocol/session/model/update.js';
import type { SessionEffect } from '../../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../../runtime/effects/outcomes.js';
import type { SessionMessageStream } from '../../event/message-stream.js';
import type { SessionObservationClock } from '../../shared/observation/clock.js';
import type { ProviderSessionResource } from '../opening/resources.js';
import { mapProtocolInteraction } from '../updates.js';

type PromptEffect = Extract<SessionEffect, { readonly type: 'provider.prompt' }>;

export interface TurnUpdateContext {
  readonly clock: SessionObservationClock;
  readonly effect: PromptEffect;
  readonly output: SessionEffectOutput;
  readonly provider: ProviderSessionResource;
  readonly stream: SessionMessageStream;
  completedMessage: boolean;
}

const base = (context: TurnUpdateContext) => {
  const now = context.clock.now();
  return {
    correlation: context.effect.correlation,
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
  } as const;
};

export const publishMessageCompletion = async (context: TurnUpdateContext): Promise<void> => {
  if (context.completedMessage) return;
  const completion = context.stream.complete();
  for (const content of completion.chunks) {
    // Ordered mailbox admission is the protocol backpressure contract.
    // oxlint-disable-next-line no-await-in-loop
    await context.output.update({ ...base(context), content, type: 'provider.message_delta' });
  }
  await context.output.update({
    ...base(context),
    ...completion.summary,
    type: 'provider.message_completed',
  });
  context.completedMessage = true;
};

export const publishTurnUsage = async (
  context: TurnUpdateContext,
  usage: Parameters<ProviderSessionResource['usage']['observe']>[0],
): Promise<AgentSessionUsage> => {
  const cumulative = context.provider.usage.observe(usage);
  await context.output.update({ ...base(context), type: 'provider.usage', usage: cumulative });
  return cumulative;
};

export const publishTurnUpdate = async (
  context: TurnUpdateContext,
  update: SessionProtocolUpdate,
): Promise<void> => {
  const observed = base(context);
  switch (update.type) {
    case 'message.delta':
      for (const content of context.stream.push(update.content)) {
        // Ordered mailbox admission is the protocol backpressure contract.
        // oxlint-disable-next-line no-await-in-loop
        await context.output.update({ ...observed, content, type: 'provider.message_delta' });
      }
      return;
    case 'message.completed':
      return publishMessageCompletion(context);
    case 'progress':
      await context.output.update({
        ...observed,
        message: update.message,
        type: 'provider.progress',
      });
      return;
    case 'tool':
      await context.output.update({ ...observed, ...update, type: 'provider.tool' });
      return;
    case 'plan':
      await context.output.update({ ...observed, items: update.items, type: 'provider.plan' });
      return;
    case 'usage':
      await publishTurnUsage(context, update.usage);
      return;
    case 'interaction.requested':
      await context.output.update({
        ...observed,
        providerResourceId: context.effect.providerResourceId,
        request: mapProtocolInteraction(update.request),
        scope: { kind: 'turn', turnId: context.effect.correlation.turnId },
        type: 'provider.interaction_requested',
      });
  }
};
