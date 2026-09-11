import type { NormalizedAcpConfiguration } from '../../configuration/catalog.js';
import type { AgentDefinition, JsonObject } from '../../contracts/agent-definition.js';
import type { AgentLaunchEvidence } from '../../contracts/launch.js';
import type { AgentFault } from '../../contracts/manager/core.js';
import {
  protocolFailureDetails,
  redactDiagnosticDetails,
  sanitizeDiagnosticDetails,
} from '../../diagnostics/diagnostic.js';
import { ProcessStartError, type OwnedProcess, type ProcessSpawner } from '../../process/index.js';
import {
  ProtocolConfigurationError,
  type ProtocolConfigurationDriver,
} from '../../protocol/configuration-driver.js';
import { createBoundedOutput } from '../output/bounded-output.js';
import { launchEnvironment } from '../process/launch-environment.js';
import { literalArguments } from '../process/literal-launch.js';
import { createRedactionChannel } from '../security/redaction/channel.js';
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
  | Readonly<{ readonly status: 'timed_out'; readonly error?: AgentFault }>
  | Readonly<{ readonly status: 'failed'; readonly error?: AgentFault }>
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

export interface ConfigurationCatalogEnricher {
  enrich(
    catalog: NormalizedAcpConfiguration,
    request: ConfigurationInspectionRequest,
    deadline: ConfigurationDeadline,
  ): Promise<NormalizedAcpConfiguration>;
}

export type ConfigurationCatalogEnricherResolver = (
  definitionId: string,
) => ConfigurationCatalogEnricher | undefined;

export interface ConfigurationServerProcess {
  readonly completion: Promise<unknown>;
  terminateAndReap(): Promise<{ readonly status: 'confirmed' | 'uncertain' }>;
}

export interface ConfigurationServerStartRequest {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly onStdout: (chunk: Uint8Array) => void;
}

export interface ConfigurationServerSpawner {
  start(
    request: ConfigurationServerStartRequest,
    signal: AbortSignal,
  ): Promise<ConfigurationServerProcess>;
}

type OpeningOutcome =
  | Readonly<{
      readonly status: 'opened';
      readonly session: Awaited<ReturnType<ProtocolConfigurationDriver['inspect']>>;
    }>
  | Readonly<{ readonly status: 'failed'; readonly error: unknown }>
  | Readonly<{ readonly status: 'process_exited' }>
  | Readonly<{ readonly status: ConfigurationDeadlineOutcome }>;

type OpenedOpening = Extract<OpeningOutcome, { readonly status: 'opened' }>;

interface OpeningAttempt {
  readonly opening: ReturnType<ProtocolConfigurationDriver['inspect']>;
  readonly completion: Promise<OpeningOutcome>;
}

const cleanupConfirmed = async (process: OwnedProcess): Promise<boolean> =>
  (await process.terminateAndReap()).status === 'confirmed';

const inspectionFault = (error: unknown, secrets: readonly string[] = []): AgentFault => ({
  code: 'revo.agent.protocol_failed',
  details: {
    diagnostic: {
      ...sanitizeDiagnosticDetails({
        provider:
          error instanceof ProtocolConfigurationError
            ? redactDiagnostic(error.details, secrets)
            : inspectionDetails(error, secrets),
      }),
    },
  },
  message: inspectionMessage(error, secrets),
  phase: 'execution',
  retryable: false,
});

const inspectionDetails = (error: unknown, secrets: readonly string[]): JsonObject =>
  protocolFailureDetails(error, (value) => redact(value, secrets));

const redactDiagnostic = (details: JsonObject, secrets: readonly string[]): JsonObject =>
  sanitizeDiagnosticDetails(redactDiagnosticDetails(details, (value) => redact(value, secrets)));

const inspectionMessage = (error: unknown, secrets: readonly string[]): string => {
  const candidate =
    error instanceof ProtocolConfigurationError
      ? error.message
      : 'Agent configuration inspection failed.';
  const message = sanitizeDiagnosticDetails(
    redactDiagnosticDetails({ message: candidate }, (value) => redact(value, secrets)),
  ).message;
  return typeof message === 'string' && message.trim().length > 0
    ? message
    : 'Agent configuration inspection failed.';
};

const redact = (value: string, secrets: readonly string[]): string => {
  const channel = createRedactionChannel(secrets);
  try {
    const first = channel.feed(new TextEncoder().encode(value));
    return new TextDecoder().decode(new Uint8Array([...first, ...channel.flush()]));
  } finally {
    channel.dispose();
  }
};

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
  environment: launchEnvironment(request.definition, request.environment),
});

const primaryStartFailure = (
  error: unknown,
  deadline: ConfigurationDeadline,
  secrets: readonly string[],
): ConfigurationInspectionOutcome => {
  if (error instanceof ProcessStartError && error.cleanup === 'uncertain')
    return Object.freeze({ status: 'cleanup_uncertain' });
  return Object.freeze({
    status: deadline.current() ?? 'failed',
    error: inspectionFault(error, secrets),
  });
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
      (error: unknown) => Object.freeze({ error, status: 'failed' as const }),
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
): Promise<
  'closed' | { readonly status: 'failed'; readonly error: unknown } | ConfigurationDeadlineOutcome
> =>
  Promise.race([
    session.close().then(
      () => 'closed' as const,
      (error: unknown) => ({ error, status: 'failed' as const }),
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
        environment: launchEnvironment(request.definition, request.environment),
        onStdout: (chunk) => output.write(chunk),
      },
      deadline.signal,
    );
  } catch (error) {
    if (error instanceof ProcessStartError && error.cleanup === 'uncertain')
      return Object.freeze({ status: 'cleanup_uncertain' });
    return Object.freeze({
      status: deadline.current() ?? 'failed',
      error: inspectionFault(error, request.redactionSecrets),
    });
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
  } catch (error) {
    return Object.freeze({
      error: inspectionFault(error, request.redactionSecrets),
      status: 'failed',
    });
  }
};

const completeOpenedInspection = async (
  processes: ProcessSpawner,
  fallbackFor: ConfigurationCatalogFallbackResolver,
  enrichFor: ConfigurationCatalogEnricherResolver,
  request: ConfigurationInspectionRequest,
  process: OwnedProcess,
  opening: OpenedOpening,
  deadline: ConfigurationDeadline,
): Promise<ConfigurationInspectionOutcome> => {
  const close = await closeSession(opening.session, deadline);
  if (!(await cleanupConfirmed(process))) return Object.freeze({ status: 'cleanup_uncertain' });
  if (close !== 'closed') {
    if (typeof close === 'object')
      return Object.freeze({
        error: inspectionFault(close.error, request.redactionSecrets),
        status: 'failed' as const,
      });
    return Object.freeze({ status: close });
  }
  const fallback = fallbackFor(request.definition.id);
  if (opening.session.catalog.options.length === 0 && fallback !== undefined)
    return fallbackInspection(processes, fallback, request, deadline);
  const enricher = enrichFor(request.definition.id);
  let catalog = opening.session.catalog;
  if (enricher !== undefined) {
    try {
      catalog = await enricher.enrich(catalog, request, deadline);
    } catch (error) {
      if (error instanceof Error && 'cleanupUncertain' in error && error.cleanupUncertain === true)
        return Object.freeze({ status: 'cleanup_uncertain' });
      return Object.freeze({
        status: deadline.current() ?? 'failed',
        error: inspectionFault(error, request.redactionSecrets),
      });
    }
  }
  return Object.freeze({ catalog, launch: request.launch, status: 'completed' });
};

const runInspection = async (
  processes: ProcessSpawner,
  protocol: ProtocolConfigurationDriver,
  fallbackFor: ConfigurationCatalogFallbackResolver,
  enrichFor: ConfigurationCatalogEnricherResolver,
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
      return primaryStartFailure(error, deadline, request.redactionSecrets);
    }
    deadline.activity();
    const attempt = inspectOpening(protocol, request, process, deadline);
    const first = await attempt.completion;
    if (first.status !== 'opened') {
      const status = prepareUnopenedOpening(first, attempt.opening);
      if (!(await cleanupConfirmed(process))) return Object.freeze({ status: 'cleanup_uncertain' });
      return Object.freeze({
        status,
        ...(first.status === 'failed'
          ? { error: inspectionFault(first.error, request.redactionSecrets) }
          : {}),
      });
    }
    return await completeOpenedInspection(
      processes,
      fallbackFor,
      enrichFor,
      request,
      process,
      first,
      deadline,
    );
  } finally {
    deadline.finish(request.signal);
  }
};

export const createConfigurationInspector = (
  processes: ProcessSpawner,
  protocol: ProtocolConfigurationDriver,
  fallbackFor: ConfigurationCatalogFallbackResolver,
  enrichFor: ConfigurationCatalogEnricherResolver = () => undefined,
): AgentConfigurationInspector =>
  Object.freeze({
    inspect: (request: ConfigurationInspectionRequest) =>
      runInspection(processes, protocol, fallbackFor, enrichFor, request),
  });
