import type { AgentFault } from '../../../../contracts/manager/core.js';
import type { AgentSessionOutputPublication } from '../../../../contracts/session/lifecycle/result.js';
import type { SessionEffect } from '../../kernel/effect/session-effect.js';
import type { SessionEffectOutput } from '../../runtime/effects/outcomes.js';
import type { SessionInterpreterResources } from '../provider/opening/resources.js';
import type { SessionEffectHandler } from '../shared/effect/handler.js';
import type { SessionObservationClock } from '../shared/observation/clock.js';

type PublishEffect = Extract<SessionEffect, { readonly type: 'output.publish' }>;

interface PublishOptions {
  readonly clock: SessionObservationClock;
  readonly resources: SessionInterpreterResources;
}

const publicationFault = (): AgentFault => ({
  code: 'revo.agent.output_write_failed',
  message: 'Session output publication failed.',
  phase: 'session_terminal',
  retryable: false,
});

export const createOutputPublicationInterpreter = (
  options: PublishOptions,
): SessionEffectHandler<'output.publish'> => {
  const claimed = new Set<string>();
  return {
    type: 'output.publish',
    execute: (candidate, output): void => {
      if (candidate.type !== 'output.publish' || claimed.has(candidate.correlation.effectId))
        return;
      claimed.add(candidate.correlation.effectId);
      void publish(candidate, output, options);
    },
  };
};

const publish = async (
  effect: PublishEffect,
  output: SessionEffectOutput,
  options: PublishOptions,
): Promise<void> => {
  const preparation = options.resources.preparations.forSession(effect.correlation);
  if (preparation === undefined) {
    emit(effect, output, options, 'failed');
    return;
  }
  const collected = preparation.output.finalize();
  if (collected.stdout.byteLength + collected.stderr.byteLength > effect.maxBytes) {
    emit(effect, output, options, 'failed');
    return;
  }
  let publication: AgentSessionOutputPublication;
  try {
    publication = await preparation.prepared.output.publish({
      ...effect.publication,
      stderr: collected.stderr.slice(),
      stdout: collected.stdout.slice(),
      truncated: collected.truncated,
    });
  } catch {
    emit(effect, output, options, 'uncertain');
    return;
  }
  if (publication.files.directory !== effect.outputDirectory) {
    emit(effect, output, options, 'failed');
    return;
  }
  emit(effect, output, options, publication.state, publication);
};

const emit = (
  effect: PublishEffect,
  output: SessionEffectOutput,
  options: PublishOptions,
  state: AgentSessionOutputPublication['state'],
  publication?: AgentSessionOutputPublication,
): void => {
  const now = options.clock.now();
  const base = {
    correlation: effect.correlation,
    observedAt: now.iso,
    observedAtMs: now.milliseconds,
  } as const;
  if (state === 'published' && publication?.state === 'published') {
    output.outcome({ ...base, output: publication, type: 'output.published' });
    return;
  }
  const unresolved =
    publication?.state === state && publication.state !== 'published'
      ? publication
      : {
          error: publicationFault(),
          files: { directory: effect.outputDirectory },
          state,
        };
  output.outcome(
    state === 'failed'
      ? { ...base, output: { ...unresolved, state: 'failed' }, type: 'output.failed' }
      : { ...base, output: { ...unresolved, state: 'uncertain' }, type: 'output.uncertain' },
  );
};
