import { AgentManagerError } from '../../../contracts/manager.js';
import type { PublicSessionCommand } from '../../../execution/session/kernel/command/public.js';
import type {
  PublicCallResolution,
  PublicCallSettlement,
  SessionCommandRuntime,
} from '../../../execution/session/runtime/actor/port.js';

type ResolutionKind = PublicCallResolution['kind'];

const hasResolutionKind = <Kind extends ResolutionKind>(
  resolution: PublicCallResolution,
  kind: Kind,
): resolution is Extract<PublicCallResolution, { readonly kind: Kind }> => resolution.kind === kind;

const internalFault = () =>
  new AgentManagerError({
    code: 'revo.agent.internal',
    message: 'The session command returned an unexpected result.',
    phase: 'session_running',
    retryable: false,
  });

export const resolutionOf = <Kind extends ResolutionKind>(
  settlement: PublicCallSettlement,
  kind: Kind,
): Extract<PublicCallResolution, { readonly kind: Kind }> => {
  if (settlement.state === 'rejected') throw new AgentManagerError(settlement.fault);
  if (!hasResolutionKind(settlement.resolution, kind)) throw internalFault();
  return settlement.resolution;
};

export const dispatchCall = async <Kind extends ResolutionKind>(
  runtime: SessionCommandRuntime,
  command: PublicSessionCommand,
  kind: Kind,
): Promise<Extract<PublicCallResolution, { readonly kind: Kind }>> => {
  const settlement = runtime.registerCall(command.call.callId);
  runtime.dispatch(command);
  return resolutionOf(await settlement, kind);
};
