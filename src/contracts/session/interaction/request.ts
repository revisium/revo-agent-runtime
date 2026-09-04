export interface AgentSessionAction {
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

export interface AgentSessionPermissionOption {
  readonly optionId: string;
  readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  readonly label: string;
}

interface AgentSessionQuestionBase {
  readonly questionId: string;
  readonly title: string;
  readonly required: boolean;
}

export type AgentSessionQuestion = AgentSessionQuestionBase &
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
        readonly options: readonly {
          readonly optionId: string;
          readonly label: string;
        }[];
        readonly selection: 'single' | 'multiple';
        readonly allowOther: boolean;
      }
  );

export type AgentSessionInteractiveRequest =
  | {
      readonly kind: 'permission';
      readonly requestId: string;
      readonly action: AgentSessionAction;
      readonly options: readonly AgentSessionPermissionOption[];
    }
  | {
      readonly kind: 'input';
      readonly requestId: string;
      readonly message: string;
      readonly questions: readonly AgentSessionQuestion[];
    };

export type AgentSessionInteractionScope =
  | { readonly kind: 'opening' }
  | { readonly kind: 'turn'; readonly turnId: string };
