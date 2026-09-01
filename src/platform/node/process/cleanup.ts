import type { ProcessCleanupOutcome, ProcessExit } from '../../../execution/process/port.js';
import { nodeErrorCode } from './errors.js';

export const processTerminationPolicy = Object.freeze({
  terminationGraceMs: 2_000,
  postKillConfirmationMs: 500,
  pollIntervalMs: 20,
});

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const processGroupIsGone = (processGroupId: number): boolean => {
  try {
    process.kill(-processGroupId, 0);
    return false;
  } catch (error) {
    return nodeErrorCode(error) === 'ESRCH';
  }
};

const signalProcessGroup = (processGroupId: number, signal: NodeJS.Signals): boolean => {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    return nodeErrorCode(error) === 'ESRCH';
  }
};

const waitForLeaderReap = async (
  completion: Promise<ProcessExit>,
  timeoutMs: number,
  wait: (milliseconds: number) => Promise<void>,
): Promise<ProcessExit | undefined> =>
  Promise.race([completion, wait(timeoutMs).then(() => undefined)]);

export interface ProcessGroupSystem {
  groupIsGone(processGroupId: number): boolean;
  signal(processGroupId: number, signal: NodeJS.Signals): boolean;
  wait(milliseconds: number): Promise<void>;
  now(): number;
}

export const nodeProcessGroupSystem: ProcessGroupSystem = Object.freeze({
  groupIsGone: processGroupIsGone,
  now: Date.now,
  signal: signalProcessGroup,
  wait: delay,
});

export const createProcessCleanup = (
  processGroupId: number,
  completion: Promise<ProcessExit>,
  system: ProcessGroupSystem = nodeProcessGroupSystem,
): (() => Promise<ProcessCleanupOutcome>) => {
  let cleanup: Promise<ProcessCleanupOutcome> | undefined;
  return () => {
    cleanup ??= (async () => {
      const waitForExit = async (timeoutMs: number): Promise<boolean> => {
        const deadline = system.now() + timeoutMs;
        const poll = async (): Promise<boolean> => {
          if (system.groupIsGone(processGroupId)) return true;
          if (system.now() >= deadline) return false;
          await system.wait(processTerminationPolicy.pollIntervalMs);
          return poll();
        };
        return poll();
      };
      const termAccepted = system.signal(processGroupId, 'SIGTERM');
      if (!termAccepted) return Object.freeze({ status: 'uncertain' as const });
      let groupGone = await waitForExit(processTerminationPolicy.terminationGraceMs);
      if (!groupGone) {
        const killAccepted = system.signal(processGroupId, 'SIGKILL');
        if (!killAccepted) return Object.freeze({ status: 'uncertain' as const });
        groupGone = await waitForExit(processTerminationPolicy.postKillConfirmationMs);
      }
      const exit = await waitForLeaderReap(
        completion,
        processTerminationPolicy.postKillConfirmationMs,
        (milliseconds) => system.wait(milliseconds),
      );
      return groupGone && exit !== undefined
        ? Object.freeze({ exit, status: 'confirmed' })
        : Object.freeze({ status: 'uncertain' });
    })();
    return cleanup;
  };
};
