export interface ClockReading {
  readonly iso: string;
  readonly milliseconds: number;
}

export interface ScheduledTask {
  cancel(): void;
}

export interface SessionClock {
  now(): ClockReading;
  schedule(delayMs: number, run: () => void): ScheduledTask;
}

export const systemSessionClock: SessionClock = {
  now: () => {
    const milliseconds = Date.now();
    return { iso: new Date(milliseconds).toISOString(), milliseconds };
  },
  schedule: (delayMs, run) => {
    const handle = setTimeout(run, delayMs);
    return { cancel: () => clearTimeout(handle) };
  },
};
