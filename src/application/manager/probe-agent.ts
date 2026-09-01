import type { AgentDescriptor, AgentProbeResult } from '../../contracts/manager.js';
import type { ValidatedAgentDefinition } from '../../definition/index.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import { internalProbeError, unavailableProbeFault } from '../faults/agent-faults.js';

export type AgentProbeAttempt =
  | Readonly<{ readonly status: 'completed'; readonly result: AgentProbeResult }>
  | Readonly<{ readonly status: 'aborted' }>
  | Readonly<{ readonly status: 'failed'; readonly error: ReturnType<typeof internalProbeError> }>;

const availableResult = (
  descriptor: AgentDescriptor,
  launch: Readonly<{ executable: string; reportedVersion: string }>,
): AgentProbeResult =>
  Object.freeze({
    agent: Object.freeze({ ...descriptor.agent }),
    definitionDigest: descriptor.definitionDigest,
    executable: launch.executable,
    reportedVersion: launch.reportedVersion,
    status: 'available',
  });

const unavailableResult = (
  descriptor: AgentDescriptor,
  error: NonNullable<ReturnType<typeof unavailableProbeFault>>,
): AgentProbeResult =>
  Object.freeze({
    agent: Object.freeze({ ...descriptor.agent }),
    definitionDigest: descriptor.definitionDigest,
    error,
    status: 'unavailable',
  });

export const runAgentProbe = async (input: {
  readonly descriptor: AgentDescriptor;
  readonly definition: ValidatedAgentDefinition;
  readonly executablePreflight: ExecutablePreflight;
  readonly signal: AbortSignal;
}): Promise<AgentProbeAttempt> => {
  let preflight;
  try {
    preflight = await input.executablePreflight.probe(input.definition.definition, input.signal);
  } catch {
    return Object.freeze({ error: internalProbeError(), status: 'failed' });
  }
  if (preflight.status === 'aborted') return Object.freeze({ status: 'aborted' });
  if (preflight.status === 'ready')
    return Object.freeze({
      result: availableResult(input.descriptor, preflight.launch),
      status: 'completed',
    });
  const error = unavailableProbeFault(preflight.reason);
  if (error === undefined) return Object.freeze({ error: internalProbeError(), status: 'failed' });
  return Object.freeze({
    result: unavailableResult(input.descriptor, error),
    status: 'completed',
  });
};
