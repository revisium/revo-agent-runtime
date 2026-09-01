import type { NormalizedAcpConfiguration } from '../../configuration/catalog.js';
import type { AgentDefinition } from '../../contracts/agent-definition.js';
import type { AgentLaunchEvidence } from '../../contracts/manager.js';
import type { ProtocolConfigurationDriver } from '../../protocol/configuration-driver.js';
import { createBoundedOutput } from '../output/bounded-output.js';
import { literalArguments } from '../process/literal-launch.js';
import { ProcessStartError, type OwnedProcess, type ProcessSpawner } from '../process/port.js';
import { ConfigurationDeadline, type ConfigurationDeadlineOutcome } from './deadline.js';
import type {
  ConfigurationCatalogFallback,
  ConfigurationCatalogFallbackResolver,
} from './fallback.js';

export type ConfigurationInspectionOutcome =
  | Readonly<{
      readonly status: 'completed';
      readonly catalog: NormalizedAcpConfiguration;
      readonly launch: AgentLaunchEvidence;
    }>
  | Readonly<{ readonly status: 'cancelled' }>
  | Readonly<{ readonly status: 'timed_out' }>
  | Readonly<{ readonly status: 'failed' }>
  | Readonly<{ readonly status: 'cleanup_uncertain' }>;

export interface ConfigurationInspectionRequest {
  readonly definition: AgentDefinition;
  readonly environment: Readonly<Record<string, string>>;
  readonly idleTimeoutMs: number;
  readonly launch: AgentLaunchEvidence;
  readonly maxOutputBytes: number;
  readonly redactionSecrets: readonly string[];
  readonly signal: AbortSignal;
  readonly wallClockTimeoutMs: number;
  readonly workspace: string;
}

export interface AgentConfigurationInspector {
  inspect(request: ConfigurationInspectionRequest): Promise<ConfigurationInspectionOutcome>;
}

type OpeningOutcome =
  | Readonly<{
      readonly status: 'opened';
      readonly session: Awaited<ReturnType<ProtocolConfigurationDriver['inspect']>>;
    }>
  | Readonly<{ readonly status: 'failed' | 'process_exited' }>
  | Readonly<{ readonly status: ConfigurationDeadlineOutcome }>;

type OpenedOpening = Extract<OpeningOutcome, { readonly status: 'opened' }>;

interface OpeningAttempt {
  readonly opening: ReturnType<ProtocolConfigurationDriver['inspect']>;
  readonly completion: Promise<OpeningOutcome>;
}

const cleanupConfirmed = async (process: OwnedProcess): Promise<boolean> =>
  (await process.terminateAndReap()).status === 'confirmed';

const primaryLaunch = (
  request: ConfigurationInspectionRequest,
  args: readonly string[],
): {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
} => ({
  args,
  command: request.launch.executable,
  cwd: request.workspace,
  environment: request.environment,
});

const primaryStartFailure = (
  error: unknown,
  deadline: ConfigurationDeadline,
): ConfigurationInspectionOutcome => {
  if (error instanceof ProcessStartError && error.cleanup === 'uncertain')
    return Object.freeze({ status: 'cleanup_uncertain' });
  return Object.freeze({ status: deadline.current() ?? 'failed' });
};

const inspectOpening = (
  protocol: ProtocolConfigurationDriver,
  request: ConfigurationInspectionRequest,
  process: OwnedProcess,
  deadline: ConfigurationDeadline,
): OpeningAttempt => {
  const opening = protocol.inspect({
    activity: deadline.activity,
    definition: request.definition,
    transport: process.transport,
    workspace: request.workspace,
  });
  const completion: Promise<OpeningOutcome> = Promise.race([
    opening.then(
      (session) => Object.freeze({ session, status: 'opened' as const }),
      () => Object.freeze({ status: 'failed' as const }),
    ),
    process.completion.then(() => Object.freeze({ status: 'process_exited' as const })),
    deadline.completion().then((status) => Object.freeze({ status })),
  ]);
  return { completion, opening };
};

const prepareUnopenedOpening = (
  first: Exclude<OpeningOutcome, OpenedOpening>,
  opening: ReturnType<ProtocolConfigurationDriver['inspect']>,
): 'failed' | 'cancelled' | 'timed_out' => {
  void opening.then((late) => late.close()).catch(() => undefined);
  return first.status === 'process_exited' ? 'failed' : first.status;
};

const closeSession = (
  session: Awaited<ReturnType<ProtocolConfigurationDriver['inspect']>>,
  deadline: ConfigurationDeadline,
): Promise<'closed' | 'failed' | ConfigurationDeadlineOutcome> =>
  Promise.race([
    session.close().then(
      () => 'closed' as const,
      () => 'failed' as const,
    ),
    deadline.completion(),
  ]);

const fallbackInspection = async (
  processes: ProcessSpawner,
  fallback: ConfigurationCatalogFallback,
  request: ConfigurationInspectionRequest,
  deadline: ConfigurationDeadline,
): Promise<ConfigurationInspectionOutcome> => {
  const output = createBoundedOutput({
    maxBytes: request.maxOutputBytes,
    secrets: request.redactionSecrets,
  });
  let process: OwnedProcess;
  try {
    process = await processes.start(
      {
        args: fallback.args,
        command: request.launch.executable,
        cwd: request.workspace,
        environment: request.environment,
        onStdout: (chunk) => output.write(chunk),
      },
      deadline.signal,
    );
  } catch (error) {
    if (error instanceof ProcessStartError && error.cleanup === 'uncertain')
      return Object.freeze({ status: 'cleanup_uncertain' });
    return Object.freeze({ status: deadline.current() ?? 'failed' });
  }
  deadline.activity();
  const completed = await Promise.race([
    process.completion.then((exit) => ({ exit, status: 'completed' as const })),
    deadline.completion().then((status) => ({ status })),
  ]);
  if (!(await cleanupConfirmed(process))) return Object.freeze({ status: 'cleanup_uncertain' });
  if (completed.status !== 'completed') return Object.freeze({ status: completed.status });
  const captured = output.finalize();
  if (completed.exit.exitCode !== 0 || completed.exit.signal !== null || captured.truncated)
    return Object.freeze({ status: 'failed' });
  try {
    return Object.freeze({
      catalog: fallback.parse(captured.bytes),
      launch: request.launch,
      status: 'completed',
    });
  } catch {
    return Object.freeze({ status: 'failed' });
  }
};

const runInspection = async (
  processes: ProcessSpawner,
  protocol: ProtocolConfigurationDriver,
  fallbackFor: ConfigurationCatalogFallbackResolver,
  request: ConfigurationInspectionRequest,
): Promise<ConfigurationInspectionOutcome> => {
  const args = literalArguments(request.definition);
  if (args === undefined) return Object.freeze({ status: 'failed' });
  const deadline = new ConfigurationDeadline(
    request.signal,
    request.wallClockTimeoutMs,
    request.idleTimeoutMs,
  );
  try {
    let process: OwnedProcess;
    try {
      process = await processes.start(primaryLaunch(request, args), deadline.signal);
    } catch (error) {
      return primaryStartFailure(error, deadline);
    }
    deadline.activity();
    const attempt = inspectOpening(protocol, request, process, deadline);
    const first = await attempt.completion;
    if (first.status !== 'opened') {
      const status = prepareUnopenedOpening(first, attempt.opening);
      if (!(await cleanupConfirmed(process))) return Object.freeze({ status: 'cleanup_uncertain' });
      return Object.freeze({ status });
    }
    const close = await closeSession(first.session, deadline);
    if (!(await cleanupConfirmed(process))) return Object.freeze({ status: 'cleanup_uncertain' });
    if (close !== 'closed') return Object.freeze({ status: close === 'failed' ? 'failed' : close });
    const fallback = fallbackFor(request.definition.id);
    if (first.session.catalog.options.length === 0 && fallback !== undefined)
      return fallbackInspection(processes, fallback, request, deadline);
    return Object.freeze({
      catalog: first.session.catalog,
      launch: request.launch,
      status: 'completed',
    });
  } finally {
    deadline.finish(request.signal);
  }
};

export const createConfigurationInspector = (
  processes: ProcessSpawner,
  protocol: ProtocolConfigurationDriver,
  fallbackFor: ConfigurationCatalogFallbackResolver,
): AgentConfigurationInspector =>
  Object.freeze({
    inspect: (request: ConfigurationInspectionRequest) =>
      runInspection(processes, protocol, fallbackFor, request),
  });
