import type {
  InstructionsDeliveryPlan,
  InstructionsDeliveryRequest,
} from '../execution/instructions/delivery.js';

export interface ProviderHost {
  readonly platform: string;
}

/** A provider returns its source-proven additive channel, or nothing to keep the prefix default. */
export type ProviderInstructionsDelivery = (
  request: InstructionsDeliveryRequest,
  host: ProviderHost,
) => InstructionsDeliveryPlan | undefined;
