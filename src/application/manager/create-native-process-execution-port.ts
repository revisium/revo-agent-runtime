import { NodePosixProcessSpawnDispatch } from '../../platform/process/node-posix-process-spawn-dispatch.js';
import {
  createProcessStartAttempt,
  createRawResponseCapture,
  DuplexCoordinatorRegistration,
  duplexCompletion,
  getProcessStartInvocationToken,
  submitDuplexCandidate,
  type InterimDuplexPrimaryFailure,
  type InvocationExecutionPorts,
  type InvocationTerminalObservation,
  type ProcessExitObservation,
  type ProcessSpawnRequest,
  type ProcessStartAttempt,
  type RawResponseCapture,
  type takePreparedInvocationResourcesPayload,
} from '../../runtime/execution/index.js';
import { AGENT_MANAGER_LIMITS } from '../../runtime/policy/index.js';
import { InstalledBindingRegistry } from './installed-bindings.js';

type PreparedInvocationResourcesPayload = NonNullable<
  ReturnType<typeof takePreparedInvocationResourcesPayload>
>;
type RunningExecution = Awaited<ReturnType<InvocationExecutionPorts['execution']['start']>>;
type NativeDispatch = Pick<
  NodePosixProcessSpawnDispatch,
  'beginStart' | 'inspectIdentity' | 'killUnactivated' | 'activateIo'
>;

const AFTER_DEADLINE = Symbol('after-deadline');
// Deliberate, narrow, temporary scope limit (execution-handoff.spec.md §14/§18): this slice arms
// the fixed 10-second duplex-operation bound only for the 'attach' DuplexOperation. The remaining
// nine kinds (stdin_write, stdin_end, stdout_write, stdout_end, stderr_write, stderr_end,
// protocol_write, protocol_end, parser_finish) are not yet individually bounded by this policy.
// Owner: the §14 duplex-coordinator program. Remove this comment and widen coverage once a later
// slice arms the same bound for the remaining DuplexOperation kinds and submits their own
// duplex_operation_timeout candidates through this coordinator.
const DUPLEX_OPERATION_TIMEOUT_MS = 10_000;
const AFTER_DUPLEX_OPERATION_TIMEOUT = Symbol('after-duplex-operation-timeout');
const syntheticNoProcessExit: ProcessExitObservation = Object.freeze({
  exitCode: null,
  signal: null,
});

const sleepUntil = <Sentinel>(deadlineAt: number, sentinel: Sentinel): Promise<Sentinel> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(sentinel), Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
  });

const failedObservation = (
  spawnedAt: number,
  primary: InterimDuplexPrimaryFailure = Object.freeze({ kind: 'internal' as const }),
  exit: ProcessExitObservation = syntheticNoProcessExit,
): InvocationTerminalObservation => Object.freeze({ status: 'failed', spawnedAt, exit, primary });

const attachRaceCandidate = (
  attachOutcome: typeof AFTER_DEADLINE | typeof AFTER_DUPLEX_OPERATION_TIMEOUT | undefined,
  spawnedAt: number,
  exit: ProcessExitObservation,
): InvocationTerminalObservation => {
  if (attachOutcome === AFTER_DUPLEX_OPERATION_TIMEOUT)
    return failedObservation(
      spawnedAt,
      Object.freeze({ kind: 'duplex_operation_timeout', operation: 'attach' as const }),
      exit,
    );
  if (attachOutcome === AFTER_DEADLINE)
    return Object.freeze({ status: 'cancelled' as const, spawnedAt, exit });
  return failedObservation(spawnedAt, undefined, exit);
};

const failedExecution = (spawnedAt: number): RunningExecution =>
  Object.freeze({
    spawnedAt,
    completion: Promise.resolve(failedObservation(spawnedAt)),
    requestCancellation: async (): Promise<void> => undefined,
  });

const disposeResourcesFrontEnds = (
  resources: PreparedInvocationResourcesPayload,
  rawResponseAlreadyDisposed = false,
): void => {
  resources.frontEnds.stdout.dispose();
  resources.frontEnds.stderr.dispose();
  if (!rawResponseAlreadyDisposed) resources.frontEnds.rawResponse.dispose();
};

const coordinatorFor = (
  attempt: ProcessStartAttempt,
): DuplexCoordinatorRegistration | undefined => {
  const token = getProcessStartInvocationToken(attempt);
  return token === undefined
    ? undefined
    : DuplexCoordinatorRegistration.create({
        invocationId: attempt.invocationId,
        invocationToken: token,
      });
};

const createRequest = (
  snapshot: Parameters<InvocationExecutionPorts['execution']['start']>[0],
  preparedLaunch: Parameters<InvocationExecutionPorts['execution']['start']>[1],
  resources: PreparedInvocationResourcesPayload,
): ProcessSpawnRequest =>
  Object.freeze({
    invocationId: snapshot.invocationId,
    cwd: snapshot.workspace,
    executable: preparedLaunch.executable,
    args: preparedLaunch.preparedPayloads.arguments,
    environment: preparedLaunch.childEnvironment,
    shell: false,
    stdin: 'pipe',
    stdout: resources.evidenceSinks.stdout,
    stderr: resources.evidenceSinks.stderr,
  });

export const createNativeProcessExecutionPort = (
  dispatch: NativeDispatch = new NodePosixProcessSpawnDispatch(),
  activeStateOperationTimeoutMs: number = AGENT_MANAGER_LIMITS.activeStateOperationTimeoutMs
    .default,
): InvocationExecutionPorts['execution'] =>
  Object.freeze({
    start: async (snapshot, preparedLaunch, resources): Promise<RunningExecution> => {
      if (resources === undefined) return failedExecution(Date.now());
      let rawResponseDisposed = false;
      let rawResponseCapture: RawResponseCapture | undefined;
      const disposeRawResponse = (): void => {
        if (rawResponseDisposed) return;
        rawResponseDisposed = true;
        if (rawResponseCapture === undefined) resources.frontEnds.rawResponse.dispose();
        else rawResponseCapture.dispose();
      };
      const disposeAllFrontEnds = (): void => {
        disposeRawResponse();
        disposeResourcesFrontEnds(resources, true);
      };
      const attempt = createProcessStartAttempt({ invocationId: snapshot.invocationId });
      dispatch.beginStart(attempt, createRequest(snapshot, preparedLaunch, resources));
      const settlement = await attempt.settlement;
      if (settlement.status !== 'spawn_accepted') {
        disposeAllFrontEnds();
        return failedExecution(Date.now());
      }

      const preacceptanceDeadlineAt =
        settlement.process.spawnedAt +
        Math.min(snapshot.wallClockTimeoutMs, snapshot.limits.idleTimeoutMs);

      const identity = await dispatch.inspectIdentity(
        settlement.process,
        Math.min(Date.now() + activeStateOperationTimeoutMs, preacceptanceDeadlineAt),
      );
      if (identity.status !== 'identified') {
        await dispatch.killUnactivated(settlement.process);
        disposeAllFrontEnds();
        if (identity.reason === 'deadline')
          return Object.freeze({
            spawnedAt: settlement.process.spawnedAt,
            completion: Promise.resolve(
              Object.freeze({
                status: 'cancelled' as const,
                spawnedAt: settlement.process.spawnedAt,
                exit: syntheticNoProcessExit,
              }),
            ),
            requestCancellation: async (): Promise<void> => undefined,
          });
        return failedExecution(settlement.process.spawnedAt);
      }

      rawResponseCapture = createRawResponseCapture({
        channel: resources.frontEnds.rawResponse,
        maxRawResponseBytes: preparedLaunch.limits.maxRawResponseBytes,
        previewBytes: AGENT_MANAGER_LIMITS.rawResponsePreviewBytes,
      });
      const driver = InstalledBindingRegistry.resolveProtocolDriver(
        preparedLaunch.binding.protocolDriverId,
      );
      const parserId = preparedLaunch.binding.resultParserId;
      const parser =
        parserId === undefined
          ? undefined
          : InstalledBindingRegistry.resolveResultParser(
              parserId,
              preparedLaunch.limits.maxRawResponseBytes,
              rawResponseCapture,
            );
      if (driver === undefined || parser === undefined) {
        await dispatch.killUnactivated(settlement.process);
        disposeAllFrontEnds();
        return failedExecution(settlement.process.spawnedAt);
      }

      const preparedSession = driver.create({
        invocationId: snapshot.invocationId,
        delivery: preparedLaunch.binding.delivery,
        cancellationSupported: false,
        ...(preparedLaunch.preparedPayloads.stdin === undefined
          ? {}
          : { promptBytes: preparedLaunch.preparedPayloads.stdin }),
        resultParser: parser,
      });
      const coordinator = coordinatorFor(attempt);
      if (coordinator === undefined) {
        await dispatch.killUnactivated(settlement.process);
        disposeAllFrontEnds();
        return failedExecution(settlement.process.spawnedAt);
      }
      const activation = dispatch.activateIo(
        settlement.process,
        settlement.io,
        identity.identity,
        coordinator,
        {
          secretValues: preparedLaunch.secretValues,
          maxStdoutBytes: preparedLaunch.limits.maxStdoutBytes,
          maxStderrBytes: preparedLaunch.limits.maxStderrBytes,
          evidenceFrontEnds: Object.freeze({
            stdout: resources.frontEnds.stdout,
            stderr: resources.frontEnds.stderr,
          }),
          protocolObserverSink: preparedSession.protocolOutput,
        },
      );
      if (activation.status !== 'activated') {
        disposeAllFrontEnds();
        return failedExecution(settlement.process.spawnedAt);
      }

      const attachOutcome = await Promise.race([
        preparedSession.attach(activation.process.stdin).catch(() => undefined),
        sleepUntil(preacceptanceDeadlineAt, AFTER_DEADLINE),
        sleepUntil(Date.now() + DUPLEX_OPERATION_TIMEOUT_MS, AFTER_DUPLEX_OPERATION_TIMEOUT),
      ]);
      if (
        attachOutcome === AFTER_DEADLINE ||
        attachOutcome === AFTER_DUPLEX_OPERATION_TIMEOUT ||
        attachOutcome === undefined
      ) {
        const cleanup = activation.process.terminateAndReap().catch(() => undefined);
        // activateIo already owns live pumps here; immediate front-end disposal would race their writes.
        const completion: Promise<InvocationTerminalObservation> = cleanup.then(() =>
          activation.process.completion.then(
            async (exit) => {
              disposeRawResponse();
              const candidate = attachRaceCandidate(
                attachOutcome,
                settlement.process.spawnedAt,
                exit,
              );
              submitDuplexCandidate(coordinator, candidate);
              return (await duplexCompletion(coordinator)) ?? candidate;
            },
            async () => {
              disposeRawResponse();
              const candidate = failedObservation(settlement.process.spawnedAt);
              submitDuplexCandidate(coordinator, candidate);
              return (await duplexCompletion(coordinator)) ?? candidate;
            },
          ),
        );
        return Object.freeze({
          spawnedAt: settlement.process.spawnedAt,
          completion,
          requestCancellation: async (): Promise<void> => undefined,
        });
      }
      const attachResult = attachOutcome;
      if (attachResult.status !== 'attached') {
        await activation.process.terminateAndReap();
        disposeAllFrontEnds();
        const candidate = failedObservation(
          settlement.process.spawnedAt,
          Object.freeze({ kind: attachResult.reason }),
        );
        submitDuplexCandidate(coordinator, candidate);
        return Object.freeze({
          spawnedAt: settlement.process.spawnedAt,
          completion: Promise.resolve(candidate).then(
            async () => (await duplexCompletion(coordinator)) ?? candidate,
          ),
          requestCancellation: async (): Promise<void> => undefined,
        });
      }

      const completion: Promise<InvocationTerminalObservation> = activation.process.completion
        .then(async (exit) => {
          const observation = await attachResult.session.finishAfterProtocolOutputEnd();
          disposeRawResponse();
          let candidate: InvocationTerminalObservation;
          if (observation.status === 'completed') {
            candidate =
              exit.exitCode === 0 && exit.signal === null
                ? Object.freeze({
                    status: 'completed' as const,
                    spawnedAt: settlement.process.spawnedAt,
                    exit,
                    parsedResponse: observation.response,
                    ...(observation.usage === undefined ? {} : { usage: observation.usage }),
                    ...(observation.rawResponse === undefined
                      ? {}
                      : { rawResponse: observation.rawResponse }),
                  })
                : failedObservation(
                    settlement.process.spawnedAt,
                    Object.freeze({ kind: 'process_failed' }),
                    exit,
                  );
          } else {
            const primary: InterimDuplexPrimaryFailure =
              observation.failure.kind === 'parser_failed'
                ? Object.freeze({ kind: 'parser_failed', reason: observation.failure.reason })
                : Object.freeze({ kind: 'internal' as const });
            candidate = Object.freeze({
              status: 'failed' as const,
              spawnedAt: settlement.process.spawnedAt,
              exit,
              primary,
              ...(observation.rawResponse === undefined
                ? {}
                : { rawResponse: observation.rawResponse }),
            });
          }
          submitDuplexCandidate(coordinator, candidate);
          return (await duplexCompletion(coordinator)) ?? candidate;
        })
        .catch(async () => {
          disposeRawResponse();
          const candidate = failedObservation(settlement.process.spawnedAt);
          submitDuplexCandidate(coordinator, candidate);
          return (await duplexCompletion(coordinator)) ?? candidate;
        });

      let cancellationCompletion: Promise<void> | undefined;
      const requestCancellation = (): Promise<void> => {
        if (cancellationCompletion !== undefined) return cancellationCompletion;
        const candidate: InvocationTerminalObservation = Object.freeze({
          status: 'cancelled' as const,
          spawnedAt: settlement.process.spawnedAt,
          exit: syntheticNoProcessExit,
        });
        submitDuplexCandidate(coordinator, candidate);
        cancellationCompletion = (async () => {
          const sent = await attachResult.session.requestCancellation();
          if (sent !== 'sent') await activation.process.terminateAndReap().catch(() => undefined);
        })();
        return cancellationCompletion;
      };

      return Object.freeze({
        spawnedAt: settlement.process.spawnedAt,
        completion,
        requestCancellation,
      });
    },
  });
