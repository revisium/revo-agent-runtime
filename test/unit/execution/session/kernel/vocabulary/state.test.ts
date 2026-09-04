import { expect, test } from 'vitest';

import type {
  InteractionResponseDelivery,
  InteractionState,
} from '../../../../../../src/execution/session/kernel/model/interaction-state.js';
import type {
  CheckpointProgress,
  HibernationProgress,
  OpeningProgress,
  SessionState,
  TerminalProgress,
} from '../../../../../../src/execution/session/kernel/model/session-state.js';
import type { TurnState } from '../../../../../../src/execution/session/kernel/model/turn-state.js';

type Equal<Left, Right> = [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
  ? true
  : false;

const sessionStatuses = [
  'opening',
  'idle',
  'running',
  'checkpointing',
  'hibernating',
  'closing',
  'cancelling',
  'hibernated',
  'closed',
  'cancelled',
  'timed_out',
  'failed',
  'cleanup_uncertain',
] satisfies readonly SessionState['status'][];

const turnStatuses = [
  'starting',
  'prompting',
  'streaming',
  'awaiting_interaction',
  'settling',
  'completed',
  'cancelled',
  'timed_out',
  'interrupted',
  'failed',
] satisfies readonly TurnState['status'][];

const interactionStages = [
  'publishing',
  'ready',
  'responding',
] satisfies readonly InteractionState['stage'][];

const openingStages = [
  'publishing_accepted',
  'preparing',
  'starting_process',
  'saving_process',
  'opening_provider',
  'publishing_opened',
] satisfies readonly OpeningProgress['stage'][];

const checkpointStages = [
  'capturing',
  'publishing',
] satisfies readonly CheckpointProgress['stage'][];

const hibernationStages = [
  'capturing',
  'publishing',
  'closing_provider',
  'cleaning_process',
  'removing_state',
  'publishing_output',
] satisfies readonly HibernationProgress['stage'][];

const terminalStages = [
  'settling_turn',
  'closing_provider',
  'cleaning_process',
  'removing_state',
  'publishing_event',
  'publishing_output',
] satisfies readonly TerminalProgress['stage'][];

const responseDeliveryStages = [
  'publishing',
  'delivering',
] satisfies readonly InteractionResponseDelivery['stage'][];

const exactInventories = [
  true satisfies Equal<(typeof sessionStatuses)[number], SessionState['status']>,
  true satisfies Equal<(typeof turnStatuses)[number], TurnState['status']>,
  true satisfies Equal<(typeof interactionStages)[number], InteractionState['stage']>,
  true satisfies Equal<(typeof openingStages)[number], OpeningProgress['stage']>,
  true satisfies Equal<(typeof checkpointStages)[number], CheckpointProgress['stage']>,
  true satisfies Equal<(typeof hibernationStages)[number], HibernationProgress['stage']>,
  true satisfies Equal<(typeof terminalStages)[number], TerminalProgress['stage']>,
  true satisfies Equal<
    (typeof responseDeliveryStages)[number],
    InteractionResponseDelivery['stage']
  >,
];

test('freezes exact state discriminant inventories', () => {
  expect(sessionStatuses).toHaveLength(13);
  expect(turnStatuses).toHaveLength(10);
  expect(interactionStages).toEqual(['publishing', 'ready', 'responding']);
  expect(openingStages).toHaveLength(6);
  expect(checkpointStages).toEqual(['capturing', 'publishing']);
  expect(hibernationStages).toHaveLength(6);
  expect(terminalStages).toHaveLength(6);
  expect(responseDeliveryStages).toEqual(['publishing', 'delivering']);
  expect(exactInventories).not.toContain(false);
});
