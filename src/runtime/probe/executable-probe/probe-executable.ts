import {
  matchesExecutableVersionConstraint,
  parseExecutableVersionConstraint,
} from '../../definition/index.js';
import { AgentManagerError } from '../../errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_RUNTIME_LIMITS,
  PROBE_DIAGNOSTIC_PREVIEW_BYTES,
} from '../../policy/index.js';
import type { AgentFault, AgentProbeResult } from '../../spec/index.js';
import type { ExecutableProbePort } from '../executable-probe-port/executable-probe-port.js';
import type { VersionProbeObservation } from '../executable-probe-port/version-probe-observation.js';
import { parseVersionOutput } from '../version-output/parse-version-output.js';
import type { ProbeTarget } from './probe-target.js';

const encoder = new TextEncoder();

type ProbeFaultCode = Extract<
  AgentFault['code'],
  | 'revo.agent.probe_platform_unsupported'
  | 'revo.agent.probe_spawn_failed'
  | 'revo.agent.probe_timeout'
  | 'revo.agent.probe_output_too_large'
  | 'revo.agent.probe_process_failed'
  | 'revo.agent.probe_output_invalid'
  | 'revo.agent.probe_version_mismatch'
>;

type ProbeFaultDetails = Readonly<Record<string, string | number | boolean | null>>;

const internalFailure = (): never => {
  throw new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.internal',
      message: AGENT_FAULT_MESSAGES.internalProbe,
      phase: 'probing',
      retryable: false,
    }),
  );
};

const unavailable = (
  target: ProbeTarget,
  code: ProbeFaultCode,
  message: string,
  retryable: boolean,
  details: ProbeFaultDetails,
): AgentProbeResult =>
  Object.freeze({
    status: 'unavailable',
    agent: Object.freeze({ id: target.definition.id, version: target.definition.version }),
    definitionDigest: target.definitionDigest,
    error: Object.freeze({
      code,
      message,
      phase: 'probing',
      retryable,
      details: Object.freeze({ ...details }),
    }),
  });

const available = (
  target: ProbeTarget,
  executable: string,
  reportedVersion?: string,
): AgentProbeResult =>
  Object.freeze({
    status: 'available',
    agent: Object.freeze({ id: target.definition.id, version: target.definition.version }),
    definitionDigest: target.definitionDigest,
    executable,
    ...(reportedVersion === undefined ? {} : { reportedVersion }),
  });

const truncateUtf8 = (
  value: string,
  limit: number,
): Readonly<{ value: string; truncated: boolean }> => {
  if (encoder.encode(value).byteLength <= limit) return Object.freeze({ value, truncated: false });

  let byteLength = 0;
  let end = 0;
  for (const codePoint of value) {
    const codePointBytes = encoder.encode(codePoint).byteLength;
    if (byteLength + codePointBytes > limit) break;
    byteLength += codePointBytes;
    end += codePoint.length;
  }

  return Object.freeze({ value: value.slice(0, end), truncated: true });
};

const isProbePlatform = (value: unknown): value is 'darwin' | 'linux' | 'win32' | 'other' =>
  value === 'darwin' || value === 'linux' || value === 'win32' || value === 'other';

const isResolutionReason = (value: unknown): value is 'not_found' | 'not_launchable' =>
  value === 'not_found' || value === 'not_launchable';

const isSafeSignal = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.isWellFormed() || !/^[A-Z][A-Z0-9_]*$/.test(value))
    return false;
  return !truncateUtf8(value, PROBE_DIAGNOSTIC_PREVIEW_BYTES).truncated;
};

const classifyObservation = (
  target: ProbeTarget,
  observation: VersionProbeObservation,
): AgentProbeResult => {
  if (observation.status === 'spawn_failed')
    return unavailable(
      target,
      'revo.agent.probe_spawn_failed',
      AGENT_FAULT_MESSAGES.probeStartFailed,
      true,
      { reason: 'spawn_failed' },
    );

  if (observation.status !== 'exited') return internalFailure();
  if (
    observation.overflow !== 'none' &&
    observation.overflow !== 'stdout' &&
    observation.overflow !== 'stderr' &&
    observation.overflow !== 'both'
  )
    return internalFailure();
  if (observation.overflow !== 'none')
    return unavailable(
      target,
      'revo.agent.probe_output_too_large',
      AGENT_FAULT_MESSAGES.probeOutputTooLarge,
      false,
      { stream: observation.overflow, limitBytes: AGENT_RUNTIME_LIMITS.probeStreamBytes },
    );

  if (
    (observation.exitCode !== null &&
      (!Number.isSafeInteger(observation.exitCode) ||
        observation.exitCode < 0 ||
        observation.exitCode > 255)) ||
    (observation.signal !== null && !isSafeSignal(observation.signal))
  )
    return internalFailure();
  if (observation.exitCode !== 0 || observation.signal !== null)
    return unavailable(
      target,
      'revo.agent.probe_process_failed',
      AGENT_FAULT_MESSAGES.probeProcessFailed,
      false,
      { exitCode: observation.exitCode, signal: observation.signal },
    );

  const versionProbe = target.definition.launch.versionProbe;
  if (versionProbe === undefined) return internalFailure();
  const parsed = parseVersionOutput({
    bytes: versionProbe.stream === 'stdout' ? observation.stdout : observation.stderr,
    prefix: versionProbe.prefix,
  });
  if (!parsed.valid)
    return unavailable(
      target,
      'revo.agent.probe_output_invalid',
      AGENT_FAULT_MESSAGES.probeOutputInvalid,
      false,
      { stream: versionProbe.stream, reason: parsed.reason },
    );

  const constraintSource = target.definition.constraints?.executableVersion;
  if (constraintSource === undefined) return available(target, '', parsed.version.source);
  const constraint = parseExecutableVersionConstraint(constraintSource);
  if (constraint === undefined) return internalFailure();
  if (matchesExecutableVersionConstraint(parsed.version, constraint))
    return available(target, '', parsed.version.source);

  const reportedVersion = truncateUtf8(parsed.version.source, PROBE_DIAGNOSTIC_PREVIEW_BYTES);
  const constraintPreview = truncateUtf8(constraint.source, PROBE_DIAGNOSTIC_PREVIEW_BYTES);
  return unavailable(
    target,
    'revo.agent.probe_version_mismatch',
    AGENT_FAULT_MESSAGES.probeVersionMismatch,
    false,
    {
      reportedVersionPreview: reportedVersion.value,
      reportedVersionTruncated: reportedVersion.truncated,
      constraintPreview: constraintPreview.value,
      constraintTruncated: constraintPreview.truncated,
    },
  );
};

const evaluateVersionProbe = async (
  target: ProbeTarget,
  executable: string,
  port: ExecutableProbePort,
): Promise<AgentProbeResult> => {
  const versionProbe = target.definition.launch.versionProbe;
  if (versionProbe === undefined) return internalFailure();
  const running = await port.startVersionProbe({
    executable,
    args: versionProbe.args,
    shell: false,
    timeoutMs: versionProbe.timeoutMs,
    stdoutLimitBytes: AGENT_RUNTIME_LIMITS.probeStreamBytes,
    stderrLimitBytes: AGENT_RUNTIME_LIMITS.probeStreamBytes,
  });
  const outcome = await Promise.race([
    running.completion.then((observation) =>
      Object.freeze({ type: 'completion' as const, observation }),
    ),
    running.timeout.then(() => Object.freeze({ type: 'timeout' as const })),
  ]);
  if (outcome.type === 'timeout') {
    await running.terminateAndReap();
    return unavailable(
      target,
      'revo.agent.probe_timeout',
      AGENT_FAULT_MESSAGES.probeTimeout,
      true,
      { timeoutMs: versionProbe.timeoutMs },
    );
  }

  const classified = classifyObservation(target, outcome.observation);
  if (classified.status === 'available')
    return available(target, executable, classified.reportedVersion);
  return classified;
};

export const probeExecutable = async (
  target: ProbeTarget,
  port: ExecutableProbePort,
): Promise<AgentProbeResult> => {
  try {
    const platform = port.hostPlatform();
    if (!isProbePlatform(platform)) return internalFailure();
    if (
      platform === 'other' ||
      (target.definition.constraints?.platforms !== undefined &&
        !target.definition.constraints.platforms.includes(platform))
    )
      return unavailable(
        target,
        'revo.agent.probe_platform_unsupported',
        AGENT_FAULT_MESSAGES.probePlatformUnsupported,
        false,
        { platform },
      );

    const resolution = await port.resolveExecutable({ command: target.definition.launch.command });
    if (resolution.status === 'unavailable') {
      if (!isResolutionReason(resolution.reason)) return internalFailure();
      return unavailable(
        target,
        'revo.agent.probe_spawn_failed',
        AGENT_FAULT_MESSAGES.probeExecutableUnavailable,
        false,
        { reason: resolution.reason },
      );
    }
    if (resolution.status !== 'resolved' || typeof resolution.executable !== 'string')
      return internalFailure();
    if (target.definition.launch.versionProbe === undefined)
      return available(target, resolution.executable);
    return await evaluateVersionProbe(target, resolution.executable, port);
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) throw error;
    return internalFailure();
  }
};
