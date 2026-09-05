import type { SessionProtocolCapabilities } from '../../../../../protocol/session/model/outcome.js';
import type { SessionProtocolOpening } from '../../../../../protocol/session/port/opening.js';
import type { SessionProtocolSession } from '../../../../../protocol/session/port/session.js';
import type { OwnedProcess } from '../../../../process/port.js';
import type { SessionEffect } from '../../../kernel/effect/session-effect.js';
import { ProviderOpeningRegistry } from '../../../runtime/resources/provider-openings.js';
import { ProviderSessionRegistry } from '../../../runtime/resources/provider-sessions.js';
import { SessionOutputCollector } from '../../output/collect.js';
import { ProviderPromptRegistry } from '../prompts.js';
import type { SessionUsageAccumulator } from '../usage.js';
import type { PreparedSessionOpening } from './preparation.js';

type PreparationEffect = Extract<SessionEffect, { readonly type: 'opening.prepare' }>;
type EffectCorrelation = PreparationEffect['correlation'];

export interface PreparedSessionResource {
  readonly correlation: EffectCorrelation;
  readonly opening: PreparationEffect['opening'];
  readonly prepared: PreparedSessionOpening;
  readonly output: SessionOutputCollector;
}

export interface ProviderSessionResource {
  readonly capabilities: SessionProtocolCapabilities;
  readonly preparation: PreparedSessionResource;
  readonly session: SessionProtocolSession;
  readonly usage: SessionUsageAccumulator;
}

class SessionPreparationRegistry {
  readonly #byId = new Map<string, PreparedSessionResource>();
  readonly #bySession = new Map<string, PreparedSessionResource>();

  register(id: string, resource: PreparedSessionResource): boolean {
    const sessionKey = this.#sessionKey(resource.correlation);
    if (this.#byId.has(id) || this.#bySession.has(sessionKey)) return false;
    this.#byId.set(id, resource);
    this.#bySession.set(sessionKey, resource);
    return true;
  }

  get(id: string): PreparedSessionResource | undefined {
    return this.#byId.get(id);
  }

  forSession(correlation: EffectCorrelation): PreparedSessionResource | undefined {
    return this.#bySession.get(this.#sessionKey(correlation));
  }

  #sessionKey(correlation: EffectCorrelation): string {
    return `${correlation.sessionId}\0${correlation.epoch}`;
  }
}

export interface SessionInterpreterResources {
  readonly preparations: SessionPreparationRegistry;
  readonly processes: ProviderSessionRegistry<OwnedProcess>;
  readonly providerOpenings: ProviderOpeningRegistry<SessionProtocolOpening>;
  readonly providers: ProviderSessionRegistry<ProviderSessionResource>;
  readonly prompts: ProviderPromptRegistry;
}

export const createSessionInterpreterResources = (): SessionInterpreterResources => ({
  preparations: new SessionPreparationRegistry(),
  processes: new ProviderSessionRegistry(),
  providerOpenings: new ProviderOpeningRegistry(),
  providers: new ProviderSessionRegistry(),
  prompts: new ProviderPromptRegistry(),
});
