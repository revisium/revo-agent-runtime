import type { AgentSessionInteractiveRequest } from '../../../../../src/contracts/session/interaction/request.js';
import { streamingSessionState } from './running.js';

export const permissionInteractionRequest = {
  action: { kind: 'execute' },
  kind: 'permission',
  options: [{ kind: 'allow_once', label: 'Allow', optionId: 'allow' }],
  requestId: 'request_01',
} as const satisfies AgentSessionInteractiveRequest;

export const inputInteractionRequest = {
  kind: 'input',
  message: 'Configure the operation',
  questions: [
    {
      input: 'text',
      maxLength: 5,
      minLength: 2,
      multiline: false,
      questionId: 'name',
      required: true,
      title: 'Name',
    },
    {
      input: 'number',
      integer: true,
      maximum: 3,
      minimum: 1,
      questionId: 'count',
      required: false,
      title: 'Count',
    },
    { input: 'boolean', questionId: 'confirm', required: true, title: 'Confirm' },
    {
      allowOther: true,
      input: 'select',
      options: [{ label: 'Known', optionId: 'known' }],
      questionId: 'single',
      required: true,
      selection: 'single',
      title: 'Single',
    },
    {
      allowOther: false,
      input: 'select',
      options: [
        { label: 'First', optionId: 'first' },
        { label: 'Second', optionId: 'second' },
      ],
      questionId: 'multiple',
      required: true,
      selection: 'multiple',
      title: 'Multiple',
    },
  ],
  requestId: 'request_01',
} as const satisfies AgentSessionInteractiveRequest;

export const readyInteractionState = (request: AgentSessionInteractiveRequest) => {
  const initial = streamingSessionState();
  return {
    ...initial,
    interactions: [
      {
        providerResourceId: 'provider_01',
        request,
        scope: { kind: 'turn', turnId: 'turn_01' } as const,
        stage: 'ready' as const,
      },
    ],
    timers: initial.timers.filter(({ kind }) => kind !== 'idle'),
    turn: { ...initial.turn, status: 'awaiting_interaction' as const },
  };
};
