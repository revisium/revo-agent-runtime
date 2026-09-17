import type { JsonObject } from '../../contracts/agent-definition.js';
import type { AgentInstructionsDelivery } from '../../contracts/context.js';

/** Instruction facts a provider continuation carries across incarnations. */
export interface StoredInstructions {
  readonly digest: string;
  readonly mode: AgentInstructionsDelivery['mode'];
  /** True once a prefixed first prompt reached the provider transcript. */
  readonly dispatched: boolean;
}

export type InstructionsContinuation =
  | { readonly status: 'absent' }
  | { readonly status: 'stored'; readonly value: StoredInstructions }
  | { readonly status: 'invalid' };

const digestPattern = /^[a-f0-9]{64}$/;

const isMode = (value: unknown): value is AgentInstructionsDelivery['mode'] =>
  value === 'native_append' || value === 'prompt_prefix';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the runtime-owned instruction keys written by the ACP session resource. */
export const readInstructionsContinuation = (
  data: Readonly<JsonObject>,
): InstructionsContinuation => {
  const digest = data.instructionsDigest;
  const delivery = data.instructionsDelivery;
  const dispatched = data.instructionsDispatched;
  if (digest === undefined && delivery === undefined && dispatched === undefined)
    return { status: 'absent' };
  if (
    typeof digest !== 'string' ||
    !digestPattern.test(digest) ||
    !isRecord(delivery) ||
    !isMode(delivery.mode) ||
    typeof dispatched !== 'boolean'
  )
    return { status: 'invalid' };
  return { status: 'stored', value: { digest, dispatched, mode: delivery.mode } };
};

/** A resumed incarnation must resupply exactly the checkpointed instructions, or none. */
export const instructionsMatchContinuation = (
  continuation: InstructionsContinuation,
  currentDigest: string | undefined,
): boolean => {
  if (continuation.status === 'invalid') return false;
  if (continuation.status === 'absent') return currentDigest === undefined;
  return continuation.value.digest === currentDigest;
};
