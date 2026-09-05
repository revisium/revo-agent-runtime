import type {
  SessionProtocolCancellationOutcome,
  SessionProtocolCheckpointOutcome,
  SessionProtocolCloseOutcome,
  SessionProtocolInteractionOutcome,
  SessionProtocolOpeningOutcome,
  SessionProtocolPromptOutcome,
} from '../../../../../src/protocol/session/model/outcome.js';
import type { SessionProtocolUpdate } from '../../../../../src/protocol/session/model/update.js';

export type FakeSessionProtocolStep =
  | { readonly type: 'update'; readonly value: SessionProtocolUpdate }
  | { readonly type: 'wait'; readonly barrier: string };

export interface FakeSessionProtocolOpeningScript {
  readonly kind: 'fresh' | 'resume';
  readonly steps: readonly FakeSessionProtocolStep[];
  readonly outcome: SessionProtocolOpeningOutcome;
}

export interface FakeSessionProtocolPromptScript {
  readonly steps: readonly FakeSessionProtocolStep[];
  readonly outcome: SessionProtocolPromptOutcome;
}

export interface FakeSessionProtocolScript {
  readonly openings: readonly FakeSessionProtocolOpeningScript[];
  readonly prompts?: readonly FakeSessionProtocolPromptScript[];
  readonly interactions?: readonly SessionProtocolInteractionOutcome[];
  readonly checkpoints?: readonly SessionProtocolCheckpointOutcome[];
  readonly cancellations?: readonly SessionProtocolCancellationOutcome[];
  readonly closes?: readonly SessionProtocolCloseOutcome[];
}
