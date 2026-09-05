import { AgentManagerError, type AgentFault } from '../../../../contracts/manager/core.js';
import type { AgentSessionLaunchContext } from '../../../../contracts/session/requests/open.js';
import { captureEnvironment } from '../../../../execution/invocation/environment.js';

const contextError = (code: AgentFault['code'], message: string): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({ code, message, phase: 'session_opening', retryable: false }),
  );

export interface CapturedSessionLaunchContext {
  readonly environment: Readonly<{
    readonly values: Readonly<Record<string, string>>;
    readonly secrets: readonly string[];
  }>;
  readonly signal?: AbortSignal;
}

export const captureSessionLaunchContext = (
  context: AgentSessionLaunchContext | undefined,
  hostEnvironment: Readonly<Record<string, string | undefined>>,
): CapturedSessionLaunchContext => {
  if (context?.signal?.aborted)
    throw contextError('revo.agent.cancelled', 'Session opening was cancelled.');
  try {
    return Object.freeze({
      environment: captureEnvironment(context?.environment, hostEnvironment),
      ...(context?.signal === undefined ? {} : { signal: context.signal }),
    });
  } catch {
    throw contextError('revo.agent.definition_invalid', 'Session environment is invalid.');
  }
};
