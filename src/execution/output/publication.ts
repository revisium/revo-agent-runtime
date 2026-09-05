import type { AgentEvent } from '../../contracts/manager/events.js';
import type { AgentInvocationResult } from '../../contracts/manager/invocation.js';
import type { ClaimedInvocationOutput } from './claim.js';

export interface ClaimedOutputPublication {
  readonly events: readonly AgentEvent[];
  readonly maxEventBytes: number;
  readonly maxEventsFileBytes: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly rawResponse?: Uint8Array;
  readonly result: AgentInvocationResult;
}

export type ClaimedOutputPublicationResult =
  | Readonly<{ status: 'published'; files: readonly string[] }>
  | Readonly<{ status: 'failed'; files: readonly string[] }>
  | Readonly<{ status: 'uncertain'; files: readonly string[] }>;

/** Publishes only through an output leaf capability issued after output admission. */
export interface ClaimedInvocationOutputPublisher {
  publish(
    output: ClaimedInvocationOutput,
    input: ClaimedOutputPublication,
  ): Promise<ClaimedOutputPublicationResult>;
}
