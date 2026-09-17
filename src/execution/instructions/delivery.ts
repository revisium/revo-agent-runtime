import type { JsonObject } from '../../contracts/agent-definition.js';
import type { AgentInstructionsDelivery } from '../../contracts/context.js';

/** Pre-spawn facts a provider needs to choose an additive native channel. */
export interface InstructionsDeliveryRequest {
  readonly definitionId: string;
  readonly definitionVersion: string;
  readonly reportedVersion: string;
  /** Names bound by the caller context or the definition; values stay private. */
  readonly environmentNames: readonly string[];
  readonly outputDirectory: string;
  readonly instructions: string;
}

interface PromptPrefixPlan {
  readonly mode: 'prompt_prefix';
  readonly channel: 'acp:session/prompt.prefix';
}

interface SessionMetaPlan {
  readonly mode: 'native_append';
  readonly channel: 'acp:session/new._meta.systemPrompt.append';
  readonly sessionMeta: Readonly<JsonObject>;
}

interface InstructionsFilePlan {
  readonly mode: 'native_append';
  readonly channel: 'opencode:config.instructions-file';
  readonly environment: Readonly<Record<string, string>>;
  readonly artifact: { readonly path: string; readonly bytes: Uint8Array };
}

export type InstructionsDeliveryPlan = PromptPrefixPlan | SessionMetaPlan | InstructionsFilePlan;

/** Pure decision port: no I/O, no Node, composed with provider implementations at the root. */
export type InstructionsDeliveryResolver = (
  request: InstructionsDeliveryRequest,
) => InstructionsDeliveryPlan;

export const promptPrefixDelivery: PromptPrefixPlan = Object.freeze({
  channel: 'acp:session/prompt.prefix',
  mode: 'prompt_prefix',
});

export const instructionsDeliveryOf = (plan: InstructionsDeliveryPlan): AgentInstructionsDelivery =>
  Object.freeze({ channel: plan.channel, mode: plan.mode });

/**
 * A resumed incarnation keeps native delivery only when the checkpoint used it and it is
 * still eligible; a prefixed transcript stays prefixed so instructions are never doubled.
 */
export const resumedInstructionsDelivery = (
  current: InstructionsDeliveryPlan,
  storedMode: AgentInstructionsDelivery['mode'],
): InstructionsDeliveryPlan =>
  storedMode === 'native_append' && current.mode === 'native_append'
    ? current
    : promptPrefixDelivery;
