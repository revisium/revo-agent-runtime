const processGroupExists = (processGroupId: number): boolean => {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};

const signalProcessGroup = (processGroupId: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-processGroupId, signal);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
};

const waitForGroupAbsenceUntil = async (
  processGroupId: number,
  deadline: number,
  pollMs: number,
): Promise<boolean> => {
  if (!processGroupExists(processGroupId)) return true;
  if (Date.now() >= deadline) return false;

  await new Promise<void>((resolve) => {
    setTimeout(resolve, pollMs);
  });
  return waitForGroupAbsenceUntil(processGroupId, deadline, pollMs);
};

const waitForGroupAbsence = (
  processGroupId: number,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> => waitForGroupAbsenceUntil(processGroupId, Date.now() + timeoutMs, pollMs);

const waitForClose = async (completion: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), timeoutMs);
  });

  try {
    return await Promise.race([completion.then(() => true), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

export const terminateProcessGroupAndReap = async (
  processGroupId: number,
  completion: Promise<unknown>,
  timeouts: Readonly<{
    terminationGraceMs: number;
    postKillReapTimeoutMs: number;
    terminationPollMs: number;
  }>,
): Promise<void> => {
  const { terminationGraceMs, postKillReapTimeoutMs, terminationPollMs } = timeouts;
  signalProcessGroup(processGroupId, 'SIGTERM');
  if (!(await waitForGroupAbsence(processGroupId, terminationGraceMs, terminationPollMs))) {
    signalProcessGroup(processGroupId, 'SIGKILL');
    if (!(await waitForGroupAbsence(processGroupId, postKillReapTimeoutMs, terminationPollMs)))
      throw new Error('Process group did not terminate after SIGKILL.');
  }

  if (!(await waitForClose(completion, postKillReapTimeoutMs)))
    throw new Error('Process leader did not close after its group terminated.');
};
