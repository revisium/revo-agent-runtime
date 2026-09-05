import type { AgentUsage } from '../../../contracts/manager.js';

interface SessionProtocolAction {
  readonly title?: string;
  readonly kind:
    | 'read'
    | 'edit'
    | 'delete'
    | 'move'
    | 'search'
    | 'execute'
    | 'think'
    | 'fetch'
    | 'switch_mode'
    | 'other';
}

interface SessionProtocolPermissionOption {
  readonly optionId: string;
  readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  readonly label: string;
}

interface SessionProtocolQuestionBase {
  readonly questionId: string;
  readonly title: string;
  readonly required: boolean;
}

export type SessionProtocolQuestion = SessionProtocolQuestionBase &
  (
    | {
        readonly input: 'text';
        readonly multiline: boolean;
        readonly minLength?: number;
        readonly maxLength: number;
      }
    | {
        readonly input: 'number';
        readonly integer: boolean;
        readonly minimum?: number;
        readonly maximum?: number;
      }
    | { readonly input: 'boolean' }
    | {
        readonly input: 'select';
        readonly options: readonly { readonly optionId: string; readonly label: string }[];
        readonly selection: 'single' | 'multiple';
        readonly allowOther: boolean;
      }
  );

export type SessionProtocolInteractionRequest =
  | {
      readonly kind: 'permission';
      readonly requestId: string;
      readonly action: SessionProtocolAction;
      readonly options: readonly SessionProtocolPermissionOption[];
    }
  | {
      readonly kind: 'input';
      readonly requestId: string;
      readonly message: string;
      readonly questions: readonly SessionProtocolQuestion[];
    };

interface SessionProtocolPlanItem {
  readonly itemId: string;
  readonly title: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export type SessionProtocolUpdate =
  | { readonly type: 'message.delta'; readonly content: string }
  | { readonly type: 'message.completed' }
  | { readonly type: 'progress'; readonly message: string }
  | {
      readonly type: 'tool';
      readonly toolCallId: string;
      readonly kind: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other';
      readonly title: string;
      readonly status: 'started' | 'in_progress' | 'completed' | 'failed';
    }
  | { readonly type: 'plan'; readonly items: readonly SessionProtocolPlanItem[] }
  | { readonly type: 'usage'; readonly usage: AgentUsage }
  | { readonly type: 'interaction.requested'; readonly request: SessionProtocolInteractionRequest };
