interface ScheduledOperationTimeout {
  cancel(): void;
}

export interface SessionOperationTimer {
  schedule(milliseconds: number, callback: () => void): ScheduledOperationTimeout;
}

export const systemSessionOperationTimer: SessionOperationTimer = Object.freeze({
  schedule: (milliseconds: number, callback: () => void): ScheduledOperationTimeout => {
    const handle = setTimeout(callback, milliseconds);
    return Object.freeze({ cancel: () => clearTimeout(handle) });
  },
});
