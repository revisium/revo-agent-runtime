import type { ProcessCleanupOutcome } from './process-cleanup-outcome.js';

type ProcessGroupState = 'absent' | 'present';

interface ProcessTerminationHooks {
  readonly probe?: (processGroupId: number) => ProcessGroupState;
  readonly signal?: (processGroupId: number, signal: NodeJS.Signals) => void;
}

// The Linux/Node port has synchronous conclusive inspection and a non-rejecting close source.
// inspection_timeout, group_state_unknown, post_kill_confirmation_timeout, and
// leader_reap_rejected remain owned by a future port with async/uncertain inspection.
const isNodeErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

const probeProcessGroup = (processGroupId: number): ProcessGroupState => {
  try {
    process.kill(-processGroupId, 0);
    return 'present';
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'ESRCH')) return 'absent';
    if (isNodeErrorCode(error, 'EPERM')) return 'present';
    throw error;
  }
};

const signalProcessGroup = (processGroupId: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-processGroupId, signal);
  } catch (error: unknown) {
    if (isNodeErrorCode(error, 'ESRCH')) return;
    throw error;
  }
};

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, delayMs));
    timer.unref?.();
  });

const waitForGroupAbsenceUntil = async (
  processGroupId: number,
  deadline: number,
  pollMs: number,
  probe: (processGroupId: number) => ProcessGroupState,
): Promise<ProcessGroupState | 'inspection_rejected'> => {
  try {
    const state = probe(processGroupId);
    if (state === 'absent') return 'absent';
    if (Date.now() >= deadline) return 'present';
  } catch {
    return 'inspection_rejected';
  }
  await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  return waitForGroupAbsenceUntil(processGroupId, deadline, pollMs, probe);
};

const waitForCloseUntil = async (
  completion: Promise<unknown>,
  deadline: number,
): Promise<boolean> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    timeoutId.unref?.();
  });

  try {
    return await Promise.race([
      completion.then(
        () => true,
        () => false,
      ),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

const cleanupFailure = (input: ProcessCleanupOutcome): ProcessCleanupOutcome =>
  Object.freeze(input);

const signalTerm = (
  processGroupId: number,
  signal: (processGroupId: number, signal: NodeJS.Signals) => void,
): ProcessCleanupOutcome | undefined => {
  try {
    signal(processGroupId, 'SIGTERM');
    return undefined;
  } catch {
    return cleanupFailure({
      cause: 'termination_rejected',
      termSent: false,
      killSent: false,
      lastKnownGroupState: 'present',
      leaderReapState: 'unknown',
    });
  }
};

const signalKill = (
  processGroupId: number,
  signal: (processGroupId: number, signal: NodeJS.Signals) => void,
): ProcessCleanupOutcome | undefined => {
  try {
    signal(processGroupId, 'SIGKILL');
    return undefined;
  } catch {
    return cleanupFailure({
      cause: 'post_kill_confirmation_rejected',
      termSent: true,
      killSent: false,
      lastKnownGroupState: 'present',
      leaderReapState: 'unknown',
    });
  }
};

const waitForPostKillConfirmation = async (
  processGroupId: number,
  completion: Promise<unknown>,
  deadline: number,
  pollMs: number,
  probe: (processGroupId: number) => ProcessGroupState,
  previousGroupState: ProcessGroupState | 'inspection_rejected' = 'present',
  previousLeaderReaped = false,
): Promise<ProcessCleanupOutcome | undefined> => {
  if (Date.now() > deadline) return postKillFailure(previousGroupState, previousLeaderReaped);

  const groupState = await waitForGroupAbsenceUntil(processGroupId, Date.now(), pollMs, probe);
  const leaderReaped = await waitForCloseUntil(completion, Date.now());
  if (groupState === 'absent' && leaderReaped) return undefined;
  await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  return waitForPostKillConfirmation(
    processGroupId,
    completion,
    deadline,
    pollMs,
    probe,
    groupState,
    leaderReaped,
  );
};

const postKillFailure = (
  groupState: ProcessGroupState | 'inspection_rejected',
  leaderReaped: boolean,
): ProcessCleanupOutcome => {
  if (groupState === 'inspection_rejected')
    return cleanupFailure({
      cause: 'post_kill_confirmation_rejected',
      termSent: true,
      killSent: true,
      lastKnownGroupState: 'unknown',
      leaderReapState: leaderReaped ? 'confirmed' : 'pending',
    });
  if (groupState === 'present')
    return cleanupFailure({
      cause: 'group_still_live',
      termSent: true,
      killSent: true,
      lastKnownGroupState: 'present',
      leaderReapState: leaderReaped ? 'confirmed' : 'pending',
    });
  return cleanupFailure({
    cause: 'leader_reap_timeout',
    termSent: true,
    killSent: true,
    lastKnownGroupState: 'absent',
    leaderReapState: 'pending',
  });
};

export const terminateProcessGroupAndReap = async (
  processGroupId: number,
  completion: Promise<unknown>,
  timeouts: Readonly<{
    reconcileTimeoutMs: number;
    terminationGraceMs: number;
    postKillTimeoutMs: number;
    postTermReapTimeoutMs: number;
    terminationPollMs: number;
  }>,
  hooks: ProcessTerminationHooks = {},
): Promise<ProcessCleanupOutcome | undefined> => {
  const probe = hooks.probe ?? probeProcessGroup;
  const signal = hooks.signal ?? signalProcessGroup;
  const reconcileDeadline = Date.now() + timeouts.reconcileTimeoutMs;
  const reconciled = await waitForGroupAbsenceUntil(
    processGroupId,
    reconcileDeadline,
    timeouts.terminationPollMs,
    probe,
  );

  if (reconciled === 'inspection_rejected')
    return cleanupFailure({
      cause: 'inspection_rejected',
      termSent: false,
      killSent: false,
      lastKnownGroupState: 'unknown',
      leaderReapState: 'unknown',
    });

  if (reconciled === 'absent') {
    if (await waitForCloseUntil(completion, reconcileDeadline)) return undefined;
    return cleanupFailure({
      cause: 'leader_reap_timeout',
      termSent: false,
      killSent: false,
      lastKnownGroupState: 'absent',
      leaderReapState: 'pending',
    });
  }

  const termFailure = signalTerm(processGroupId, signal);
  if (termFailure !== undefined) return termFailure;

  const afterTerm = await waitForGroupAbsenceUntil(
    processGroupId,
    Date.now() + timeouts.terminationGraceMs,
    timeouts.terminationPollMs,
    probe,
  );
  if (afterTerm === 'inspection_rejected')
    return cleanupFailure({
      cause: 'inspection_rejected',
      termSent: true,
      killSent: false,
      lastKnownGroupState: 'unknown',
      leaderReapState: 'unknown',
    });
  if (afterTerm === 'absent') {
    if (await waitForCloseUntil(completion, Date.now() + timeouts.postTermReapTimeoutMs))
      return undefined;
    return cleanupFailure({
      cause: 'leader_reap_timeout',
      termSent: true,
      killSent: false,
      lastKnownGroupState: 'absent',
      leaderReapState: 'pending',
    });
  }

  const killFailure = signalKill(processGroupId, signal);
  if (killFailure !== undefined) return killFailure;

  return waitForPostKillConfirmation(
    processGroupId,
    completion,
    Date.now() + timeouts.postKillTimeoutMs,
    timeouts.terminationPollMs,
    probe,
  );
};
