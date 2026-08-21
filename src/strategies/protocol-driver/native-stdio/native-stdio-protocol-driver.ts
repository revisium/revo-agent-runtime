import type {
  AttachedProtocolSession,
  ParserFailureReason,
  PreparedProtocolSession,
  ProcessInputSink,
  ProcessOutputSink,
  ProtocolAttachResult,
  ProtocolDriverCreateRequest,
  ProtocolDriverId,
  ProtocolDriverPort,
  ProtocolObservationResult,
  ResultParserPort,
} from '../../../runtime/execution/index.js';

interface ParserFailureState {
  failure?: ParserFailureReason;
}

const parserFailure = (reason: ParserFailureReason): ProtocolObservationResult =>
  Object.freeze({ status: 'failed', failure: Object.freeze({ kind: 'parser_failed', reason }) });

const completedObservation = (
  result: Extract<ReturnType<ResultParserPort['endProtocolBytes']>, { status: 'completed' }>,
): ProtocolObservationResult =>
  Object.freeze({
    status: 'completed',
    response: result.response,
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.raw === undefined ? {} : { rawResponse: result.raw }),
  });

const failedObservation = (
  result: Extract<ReturnType<ResultParserPort['endProtocolBytes']>, { status: 'failed' }>,
): ProtocolObservationResult =>
  Object.freeze({
    status: 'failed',
    failure: Object.freeze({ kind: 'parser_failed', reason: result.reason }),
    ...(result.raw === undefined ? {} : { rawResponse: result.raw }),
  });

const createProtocolOutput = (
  resultParser: ResultParserPort,
  failureState: ParserFailureState,
): ProcessOutputSink =>
  Object.freeze({
    write(chunk: Uint8Array): Promise<void> {
      const result = resultParser.writeProtocolBytes(chunk);
      if (result.status === 'observed') return Promise.resolve();
      failureState.failure = result.reason;
      return Promise.reject(new Error(result.reason));
    },
    end: async (): Promise<void> => undefined,
  });

const attachedSession = (
  input: ProcessInputSink,
  resultParser: ResultParserPort,
  failureState: ParserFailureState,
): AttachedProtocolSession =>
  Object.freeze({
    async finishAfterProtocolOutputEnd(): Promise<ProtocolObservationResult> {
      if (failureState.failure !== undefined) return parserFailure(failureState.failure);
      const result = resultParser.endProtocolBytes();
      return result.status === 'completed'
        ? completedObservation(result)
        : failedObservation(result);
    },
    requestCancellation: async (): Promise<'unsupported'> => 'unsupported',
    closeInput: async (): Promise<void> => input.end(),
    dispose: (): void => resultParser.dispose(),
  });

const attachSession = async (
  request: ProtocolDriverCreateRequest & { readonly resultParser: ResultParserPort },
  input: ProcessInputSink,
  failureState: ParserFailureState,
): Promise<ProtocolAttachResult> => {
  if (request.delivery.prompt === 'stdin') {
    if (request.promptBytes === undefined)
      return Object.freeze({ status: 'failed', reason: 'attach_failed' });
    try {
      await input.write(request.promptBytes);
    } catch {
      return Object.freeze({ status: 'failed', reason: 'stdin_write_failed' });
    }
  }

  try {
    await input.end();
  } catch {
    return Object.freeze({ status: 'failed', reason: 'stdin_end_failed' });
  }

  return Object.freeze({
    status: 'attached',
    session: attachedSession(input, request.resultParser, failureState),
  });
};

export class NativeStdioProtocolDriver implements ProtocolDriverPort {
  readonly id: ProtocolDriverId = 'native/stdio-v1';

  create(request: ProtocolDriverCreateRequest): PreparedProtocolSession {
    if (request.resultParser === undefined)
      throw new Error('NativeStdioProtocolDriver requires resultParser for stdout delivery.');
    const resultParser = request.resultParser;
    const failureState: ParserFailureState = {};
    const protocolOutput = createProtocolOutput(resultParser, failureState);
    const parserRequest = { ...request, resultParser };

    return Object.freeze({
      protocolOutput,
      attach: (input: ProcessInputSink): Promise<ProtocolAttachResult> =>
        attachSession(parserRequest, input, failureState),
      dispose: (): void => resultParser.dispose(),
    });
  }
}
