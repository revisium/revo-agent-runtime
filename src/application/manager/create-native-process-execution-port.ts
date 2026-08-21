import { NodePosixProcessSpawnDispatch } from '../../platform/process/node-posix-process-spawn-dispatch.js';
import {
  createProcessStartAttempt,
  DuplexCoordinatorRegistration,
  getProcessStartInvocationToken,
  type InvocationExecutionPorts,
  type InvocationTerminalObservation,
  type ProcessSpawnRequest,
  type ProcessStartAttempt,
  type takePreparedInvocationResourcesPayload,
} from '../../runtime/execution/index.js';
import { InstalledBindingRegistry } from './installed-bindings.js';

type PreparedInvocationResourcesPayload = NonNullable<
  ReturnType<typeof takePreparedInvocationResourcesPayload>
>;
type RunningExecution = Awaited<ReturnType<InvocationExecutionPorts['execution']['start']>>;
type NativeDispatch = Pick<
  NodePosixProcessSpawnDispatch,
  'beginStart' | 'inspectIdentity' | 'killUnactivated' | 'activateIo'
>;

const activeStateInspectionTimeoutMs = 5_000;

const failedExecution = (): RunningExecution =>
  Object.freeze({
    completion: Promise.resolve(Object.freeze({ status: 'failed' as const })),
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
): InvocationExecutionPorts['execution'] =>
  Object.freeze({
    start: async (snapshot, preparedLaunch, resources): Promise<RunningExecution> => {
      if (resources === undefined) return failedExecution();
      let rawResponseDisposed = false;
      const disposeRawResponse = (): void => {
        if (rawResponseDisposed) return;
        rawResponseDisposed = true;
        resources.frontEnds.rawResponse.dispose();
      };
      const disposeAllFrontEnds = (): void =>
        disposeResourcesFrontEnds(resources, rawResponseDisposed);
      const attempt = createProcessStartAttempt({ invocationId: snapshot.invocationId });
      dispatch.beginStart(attempt, createRequest(snapshot, preparedLaunch, resources));
      const settlement = await attempt.settlement;
      if (settlement.status !== 'spawn_accepted') {
        disposeAllFrontEnds();
        return failedExecution();
      }

      const identity = await dispatch.inspectIdentity(
        settlement.process,
        Date.now() + activeStateInspectionTimeoutMs,
      );
      if (identity.status !== 'identified') {
        await dispatch.killUnactivated(settlement.process);
        disposeAllFrontEnds();
        return failedExecution();
      }

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
            );
      if (driver === undefined || parser === undefined) {
        await dispatch.killUnactivated(settlement.process);
        disposeAllFrontEnds();
        return failedExecution();
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
        return failedExecution();
      }
      disposeRawResponse();
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
        return failedExecution();
      }

      const attachResult = await preparedSession.attach(activation.process.stdin);
      if (attachResult.status !== 'attached') {
        await activation.process.terminateAndReap();
        disposeAllFrontEnds();
        return failedExecution();
      }

      const completion: Promise<InvocationTerminalObservation> = activation.process.completion
        .then(() => attachResult.session.finishAfterProtocolOutputEnd())
        .then((observation) => {
          if (observation.status === 'completed')
            return Object.freeze({
              status: 'completed' as const,
              parsedResponse: observation.response,
              ...(observation.usage === undefined ? {} : { usage: observation.usage }),
            });
          return Object.freeze({ status: 'failed' as const });
        });

      return Object.freeze({
        completion,
        requestCancellation: async (): Promise<void> => {
          const sent = await attachResult.session.requestCancellation();
          if (sent !== 'sent') await activation.process.terminateAndReap();
        },
      });
    },
  });
