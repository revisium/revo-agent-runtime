import type { AgentDefinition } from '../../contracts/agent-definition.js';
import type { AgentLaunchEvidence } from '../../contracts/manager.js';
import type { ExecutableProbePort, ProbeHostPlatform, VersionProbeObservation } from './port.js';
import { parseVersionOutput, type VersionOutputFailureReason } from './version-output.js';

export type ExecutablePreflightFailure = Readonly<{
  status: 'rejected';
  reason:
    | 'platform_unsupported'
    | 'executable_not_found'
    | 'executable_not_launchable'
    | 'probe_spawn_failed'
    | 'probe_timeout'
    | 'probe_cleanup_failed'
    | 'probe_output_too_large'
    | 'probe_process_failed'
    | 'probe_output_invalid';
  outputReason?: VersionOutputFailureReason;
}>;

export type ExecutablePreflightOutcome =
  | Readonly<{ status: 'ready'; launch: AgentLaunchEvidence }>
  | Readonly<{ status: 'aborted' }>
  | ExecutablePreflightFailure;

export interface ExecutablePreflight {
  probe(definition: AgentDefinition, signal: AbortSignal): Promise<ExecutablePreflightOutcome>;
}

const failure = (
  reason: ExecutablePreflightFailure['reason'],
  outputReason?: VersionOutputFailureReason,
): ExecutablePreflightFailure =>
  Object.freeze({
    reason,
    status: 'rejected',
    ...(outputReason === undefined ? {} : { outputReason }),
  });

const supportedPlatform = (
  definition: AgentDefinition,
  platform: ProbeHostPlatform,
): platform is 'darwin' | 'linux' | 'win32' =>
  platform !== 'other' &&
  (definition.constraints?.platforms === undefined ||
    definition.constraints.platforms.includes(platform));

const absoluteForPlatform = (platform: 'darwin' | 'linux' | 'win32', value: string): boolean =>
  platform === 'win32'
    ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(value)
    : value.startsWith('/');

const classifyObservation = (
  definition: AgentDefinition,
  observation: VersionProbeObservation,
): ExecutablePreflightFailure | Readonly<{ status: 'version'; reportedVersion: string }> => {
  if (observation.status === 'spawn_failed') return failure('probe_spawn_failed');
  if (observation.overflow !== 'none') return failure('probe_output_too_large');
  if (observation.exitCode !== 0 || observation.signal !== null)
    return failure('probe_process_failed');
  const selected =
    definition.launch.versionProbe.stream === 'stdout' ? observation.stdout : observation.stderr;
  const output = parseVersionOutput(selected, definition.launch.versionProbe.prefix);
  if (!output.valid) return failure('probe_output_invalid', output.reason);
  return Object.freeze({ reportedVersion: output.value, status: 'version' });
};

const runVersionProbe = async (
  definition: AgentDefinition,
  executable: string,
  port: ExecutableProbePort,
  signal: AbortSignal,
): Promise<ExecutablePreflightOutcome> => {
  let running;
  try {
    running = await port.startVersionProbe({
      args: definition.launch.versionProbe.args,
      environment: Object.freeze({}),
      executable,
      shell: false,
      stderrLimitBytes: 65_536,
      stdoutLimitBytes: 65_536,
      timeoutMs: definition.launch.versionProbe.timeoutMs,
    });
  } catch {
    return failure('probe_spawn_failed');
  }
  const aborted = new Promise<'aborted'>((resolve) => {
    signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
  let outcome:
    | Readonly<{ status: 'completed'; observation: VersionProbeObservation }>
    | Readonly<{ status: 'timeout' | 'aborted' }>;
  try {
    outcome = await Promise.race([
      running.completion.then((observation) => ({ observation, status: 'completed' as const })),
      running.timeout.then(() => ({ status: 'timeout' as const })),
      aborted.then(() => ({ status: 'aborted' as const })),
    ]);
  } catch {
    try {
      await running.terminateAndReap();
    } catch {
      return failure('probe_cleanup_failed');
    }
    return failure('probe_spawn_failed');
  }
  if (outcome.status !== 'completed') {
    try {
      await running.terminateAndReap();
    } catch {
      return failure('probe_cleanup_failed');
    }
    return outcome.status === 'aborted'
      ? Object.freeze({ status: 'aborted' })
      : failure('probe_timeout');
  }
  const classified = classifyObservation(definition, outcome.observation);
  return classified.status === 'version'
    ? Object.freeze({
        launch: Object.freeze({ executable, reportedVersion: classified.reportedVersion }),
        status: 'ready',
      })
    : classified;
};

export const createExecutablePreflight = (port: ExecutableProbePort): ExecutablePreflight =>
  Object.freeze({
    probe: async (
      definition: AgentDefinition,
      signal: AbortSignal,
    ): Promise<ExecutablePreflightOutcome> => {
      if (signal.aborted) return Object.freeze({ status: 'aborted' });
      const platform = port.hostPlatform();
      if (!supportedPlatform(definition, platform)) return failure('platform_unsupported');
      let resolution;
      try {
        resolution = await port.resolveExecutable(definition.launch.command);
      } catch {
        return failure('executable_not_found');
      }
      if (signal.aborted) return Object.freeze({ status: 'aborted' });
      if (resolution.status === 'unavailable')
        return failure(
          resolution.reason === 'not_found' ? 'executable_not_found' : 'executable_not_launchable',
        );
      if (!absoluteForPlatform(platform, resolution.executable))
        return failure('executable_not_launchable');
      return runVersionProbe(definition, resolution.executable, port, signal);
    },
  });
