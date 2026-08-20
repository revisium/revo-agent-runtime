import { ClaimedInvocationOutput } from './claimed-invocation-output.js';

export const isClaimedInvocationOutput = (session: unknown): session is ClaimedInvocationOutput =>
  ClaimedInvocationOutput.isAuthentic(session);
