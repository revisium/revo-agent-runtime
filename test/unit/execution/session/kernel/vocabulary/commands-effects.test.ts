import { expect, test } from 'vitest';

import type { EffectOutcomeCommand } from '../../../../../../src/execution/session/kernel/command/effect.js';
import type { ProviderCommand } from '../../../../../../src/execution/session/kernel/command/provider.js';
import type { PublicSessionCommand } from '../../../../../../src/execution/session/kernel/command/public.js';
import type { TimerCommand } from '../../../../../../src/execution/session/kernel/command/timer.js';
import type { SessionEffect } from '../../../../../../src/execution/session/kernel/effect/session-effect.js';

type Equal<Left, Right> = [Exclude<Left, Right>, Exclude<Right, Left>] extends [never, never]
  ? true
  : false;

const publicCommands = [
  'session.open',
  'session.resume',
  'turn.send',
  'interaction.respond',
  'turn.cancel',
  'session.checkpoint',
  'session.hibernate',
  'session.close',
  'session.cancel',
  'manager.shutdown',
] satisfies readonly PublicSessionCommand['type'][];

const providerCommands = [
  'provider.message_delta',
  'provider.message_completed',
  'provider.progress',
  'provider.tool',
  'provider.plan',
  'provider.interaction_requested',
  'provider.usage',
] satisfies readonly ProviderCommand['type'][];

const effectOutcomes = [
  'opening.preparation.succeeded',
  'opening.preparation.rejected',
  'opening.preparation.failed',
  'opening.preparation.timed_out',
  'process.started',
  'process.failed',
  'process.timed_out',
  'process.late_started',
  'provider.opened',
  'provider.open_failed',
  'provider.open_timed_out',
  'event.applied',
  'event.failed',
  'event.timed_out_then_applied',
  'event.timed_out_then_failed',
  'event.unknown',
  'persistence.applied',
  'persistence.failed',
  'persistence.late_applied',
  'persistence.late_failed',
  'persistence.unknown',
  'provider.prompt.accepted',
  'provider.prompt.completed',
  'provider.prompt.rejected',
  'provider.prompt.failed',
  'provider.prompt.timed_out',
  'provider.interaction.accepted',
  'provider.interaction.rejected',
  'provider.interaction.failed',
  'provider.interaction.timed_out',
  'checkpoint.captured',
  'checkpoint.unsupported',
  'checkpoint.failed',
  'checkpoint.timed_out',
  'process.cleanup.confirmed',
  'process.cleanup.uncertain',
  'output.published',
  'output.failed',
  'output.uncertain',
] satisfies readonly EffectOutcomeCommand['type'][];

const timerCommands = ['timer.fired'] satisfies readonly TimerCommand['type'][];

const effects = [
  'opening.prepare',
  'process.start',
  'provider.open',
  'provider.prompt',
  'provider.interaction.respond',
  'provider.turn.cancel',
  'provider.close',
  'event.append',
  'persistence.save',
  'persistence.remove',
  'checkpoint.capture',
  'timer.schedule',
  'timer.cancel',
  'output.publish',
  'process.cleanup',
  'public.resolve',
  'public.reject',
] satisfies readonly SessionEffect['type'][];

const exactInventories = [
  true satisfies Equal<(typeof publicCommands)[number], PublicSessionCommand['type']>,
  true satisfies Equal<(typeof providerCommands)[number], ProviderCommand['type']>,
  true satisfies Equal<(typeof effectOutcomes)[number], EffectOutcomeCommand['type']>,
  true satisfies Equal<(typeof timerCommands)[number], TimerCommand['type']>,
  true satisfies Equal<(typeof effects)[number], SessionEffect['type']>,
];

test('freezes exact command and effect inventories', () => {
  expect(publicCommands).toHaveLength(10);
  expect(providerCommands).toHaveLength(7);
  expect(effectOutcomes).toHaveLength(39);
  expect(timerCommands).toEqual(['timer.fired']);
  expect(effects).toHaveLength(17);
  expect(exactInventories).toEqual([true, true, true, true, true]);
});
