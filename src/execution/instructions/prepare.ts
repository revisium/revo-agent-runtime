import type { JsonObject } from '../../contracts/agent-definition.js';
import type { AgentInstructionsDelivery } from '../../contracts/context.js';
import {
  createPrivateOutputArtifact,
  type OutputArtifactPlatform,
  type PrivateOutputArtifact,
} from '../output/artifact.js';
import {
  instructionsDeliveryOf,
  type InstructionsDeliveryPlan,
  type InstructionsDeliveryRequest,
  type InstructionsDeliveryResolver,
} from './delivery.js';

/** Instructions ready for one process incarnation: channel decided, native artifacts created. */
export interface PreparedInstructions {
  readonly text: string;
  readonly delivery: AgentInstructionsDelivery;
  readonly sessionMeta?: Readonly<JsonObject>;
  /** Applied after the definition-owned launch environment; never carries caller secrets. */
  readonly environment?: Readonly<Record<string, string>>;
  readonly artifact?: PrivateOutputArtifact;
}

export type InstructionsPreparation =
  | { readonly status: 'prepared'; readonly value: PreparedInstructions }
  | { readonly status: 'write_failed' };

interface PrepareInstructionsOptions {
  readonly artifacts: OutputArtifactPlatform;
  readonly resolve: InstructionsDeliveryResolver;
  readonly request: InstructionsDeliveryRequest;
  /** Combines the fresh plan with a checkpointed delivery mode on resume. */
  readonly adjust?: (plan: InstructionsDeliveryPlan) => InstructionsDeliveryPlan;
}

/** Drivers receive the decision and any wire metadata, never the file handle or environment. */
export const protocolInstructions = (
  prepared: PreparedInstructions,
): Pick<PreparedInstructions, 'delivery' | 'sessionMeta' | 'text'> => ({
  delivery: prepared.delivery,
  ...(prepared.sessionMeta === undefined ? {} : { sessionMeta: prepared.sessionMeta }),
  text: prepared.text,
});

const withoutArtifact = (plan: InstructionsDeliveryPlan, text: string): PreparedInstructions => ({
  text,
  delivery: instructionsDeliveryOf(plan),
  ...('sessionMeta' in plan ? { sessionMeta: plan.sessionMeta } : {}),
});

/** Decides the delivery channel once, before spawn, and materializes any native artifact. */
export const prepareInstructionsDelivery = async (
  options: PrepareInstructionsOptions,
): Promise<InstructionsPreparation> => {
  const fresh = options.resolve(options.request);
  const plan = options.adjust?.(fresh) ?? fresh;
  const text = options.request.instructions;
  if (!('artifact' in plan)) return { status: 'prepared', value: withoutArtifact(plan, text) };
  const artifact = await createPrivateOutputArtifact(
    options.artifacts,
    plan.artifact.path,
    plan.artifact.bytes,
  );
  if (artifact === undefined) return { status: 'write_failed' };
  return {
    status: 'prepared',
    value: { ...withoutArtifact(plan, text), artifact, environment: plan.environment },
  };
};
