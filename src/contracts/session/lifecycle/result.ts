import type { AgentFault, AgentUsage } from '../../manager.js';

export interface AgentSessionUsage extends AgentUsage {
  readonly scope: 'session_cumulative';
}

export interface AgentSessionMessage {
  readonly role: 'assistant';
  readonly content: string;
}

export type AgentSessionTurnResult =
  | {
      readonly status: 'completed';
      readonly message: AgentSessionMessage;
      readonly usage?: AgentSessionUsage;
    }
  | { readonly status: 'cancelled' | 'timed_out' | 'interrupted' }
  | { readonly status: 'failed'; readonly error: AgentFault };

export type AgentSessionTurnOutcome =
  | { readonly status: 'completed'; readonly usage?: AgentSessionUsage }
  | { readonly status: 'cancelled' | 'timed_out' | 'interrupted' }
  | { readonly status: 'failed'; readonly error: AgentFault };

export interface AgentSessionOutputFiles {
  readonly directory: string;
  readonly stdout?: 'stdout.log';
  readonly stderr?: 'stderr.log';
  readonly manifest?: 'session.json';
}

export type AgentSessionOutputPublication =
  | {
      readonly state: 'published';
      readonly files: AgentSessionOutputFiles & {
        readonly stdout: 'stdout.log';
        readonly stderr: 'stderr.log';
        readonly manifest: 'session.json';
      };
    }
  | {
      readonly state: 'failed' | 'uncertain';
      readonly files: AgentSessionOutputFiles;
      readonly error: AgentFault;
    };

export type CloseAgentSessionResult =
  | { readonly state: 'closed' }
  | { readonly state: 'already_terminal' };

export type CancelAgentSessionResult =
  | { readonly state: 'requested' }
  | { readonly state: 'already_terminal' }
  | { readonly state: 'unknown' };

export type CancelAgentSessionTurnResult =
  | { readonly state: 'requested' }
  | { readonly state: 'already_completed'; readonly result: AgentSessionTurnResult }
  | { readonly state: 'session_terminal' };
