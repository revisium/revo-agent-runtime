import type { SessionCommand } from '../../command/session-command.js';

export type PersistenceOutcome = Extract<
  SessionCommand,
  { readonly type: `persistence.${string}` }
>;

export const isPersistenceOutcome = (command: SessionCommand): command is PersistenceOutcome =>
  command.type === 'persistence.applied' ||
  command.type === 'persistence.late_applied' ||
  command.type === 'persistence.failed' ||
  command.type === 'persistence.late_failed' ||
  command.type === 'persistence.unknown';

export const isPersistenceApplied = (
  command: PersistenceOutcome,
): command is Extract<
  PersistenceOutcome,
  { readonly type: 'persistence.applied' | 'persistence.late_applied' }
> => command.type === 'persistence.applied' || command.type === 'persistence.late_applied';
