import type { AgentDefinition, JsonObject } from '../../../contracts/agent-definition.js';
import type { AgentInstructionsDelivery, AgentMcpServer } from '../../../contracts/context.js';
import type { AgentFault } from '../../../contracts/manager/core.js';
import type { ProcessLaunch } from '../../../process/index.js';
import type { SessionOutputPublicationTarget } from '../../output/session/publication.js';
import type { SessionOpeningDescriptor } from '../kernel/model/opening-state.js';

type SessionProcessLaunch = Omit<ProcessLaunch, 'onStdout' | 'onStderr'>;

/** Session instructions add the checkpoint identity and whether a prefix already reached the transcript. */
export interface PreparedSessionInstructions {
  readonly text: string;
  readonly delivery: AgentInstructionsDelivery;
  readonly sessionMeta?: Readonly<JsonObject>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly artifact?: {
    readonly path: string;
    dispose(): Promise<void>;
  };
  readonly digest: string;
  readonly dispatched: boolean;
}

export interface PreparedSessionOpening {
  readonly definition: AgentDefinition;
  readonly inputs: Readonly<{
    readonly parameters: JsonObject;
    readonly permissions: JsonObject;
  }>;
  readonly instructions?: PreparedSessionInstructions;
  readonly mcpServers?: readonly AgentMcpServer[];
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
