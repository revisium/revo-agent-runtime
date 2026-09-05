import type { AgentDefinition } from '../../../../../contracts/agent-definition.js';
import type { AgentFault } from '../../../../../contracts/manager.js';
import type { SessionOutputPublicationTarget } from '../../../../output/session/publication.js';
import type { ProcessLaunch } from '../../../../process/port.js';
import type { SessionEffect } from '../../../kernel/effect/session-effect.js';

type SessionOpeningDescriptor = Extract<
  SessionEffect,
  { readonly type: 'opening.prepare' }
>['opening'];

type SessionProcessLaunch = Omit<ProcessLaunch, 'onStdout' | 'onStderr'>;

export interface PreparedSessionOpening {
  readonly definition: AgentDefinition;
  readonly launch: SessionProcessLaunch;
  readonly output: SessionOutputPublicationTarget;
}

type SessionOpeningPreparation =
  | { readonly status: 'prepared'; readonly value: PreparedSessionOpening }
  | { readonly status: 'rejected'; readonly fault: AgentFault };

/** Performs definition pinning, preflight and exclusive output claim before process start. */
export interface SessionOpeningPreparer {
  prepare(
    opening: SessionOpeningDescriptor,
    context: { readonly signal: AbortSignal },
  ): Promise<SessionOpeningPreparation>;
}
