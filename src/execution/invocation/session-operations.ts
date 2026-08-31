import type { ProtocolSession } from '../../protocol/driver.js';

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const settle = (operation: () => Promise<void>): Promise<void> => {
  try {
    return operation().catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
};

export const cancelProtocolSession = (session: ProtocolSession): void => {
  void settle(() => session.cancel());
};

export const closeProtocolSession = async (session: ProtocolSession | undefined): Promise<void> => {
  if (session === undefined) return;
  await Promise.race([settle(() => session.close()), delay(100)]);
};
