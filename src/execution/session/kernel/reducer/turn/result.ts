import type { AgentSessionTurnResult } from '../../../../../contracts/session/lifecycle/result.js';
import type { ActiveTurnState, TerminalTurnState } from '../../model/turn-state.js';

type SettlingTurn = Extract<ActiveTurnState, { readonly status: 'settling' }>;

export const projectTurnResult = (turn: SettlingTurn): AgentSessionTurnResult => {
  if (turn.progress.stage !== 'publishing_completion')
    throw new Error('Cannot project an unsettled turn result.');
  if (turn.progress.outcome.status === 'completed')
    return {
      message: turn.message,
      status: 'completed',
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
    };
  if (turn.progress.outcome.status === 'failed') return turn.progress.outcome;
  return { status: turn.progress.outcome.status };
};

// oxlint-disable-next-line typescript/consistent-return -- the checked discriminated union is exhaustive
export const terminalTurn = (
  turn: SettlingTurn,
  result: AgentSessionTurnResult,
): TerminalTurnState => {
  const {
    correlation: _correlation,
    message: _message,
    progress: _progress,
    status: _status,
    usage: _usage,
    ...base
  } = turn;
  switch (result.status) {
    case 'completed':
      return { ...base, result, status: 'completed' };
    case 'failed':
      return { ...base, result, status: 'failed' };
    case 'cancelled':
      return { ...base, result: { status: 'cancelled' }, status: 'cancelled' };
    case 'interrupted':
      return { ...base, result: { status: 'interrupted' }, status: 'interrupted' };
    case 'timed_out':
      return { ...base, result: { status: 'timed_out' }, status: 'timed_out' };
  }
};
