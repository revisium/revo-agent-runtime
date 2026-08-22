import type {
  InvocationExecutionPorts,
  NormalizedInvocationOutcome,
  RawFinalResponseEligibility,
  RawResponsePublicationResult,
  ScratchCleanupResult,
  TerminalPublicationAuthority,
  TerminalResultPublicationResult,
} from '../../../src/runtime/execution/index.js';
import type {
  AgentEvent,
  AgentInvocationResult,
  JsonObject,
  JsonValue,
} from '../../../src/runtime/spec/index.js';

type OutputAdmissionRequest = Parameters<InvocationExecutionPorts['output']['admit']>[0];
type OutputAdmissionResult = Awaited<ReturnType<InvocationExecutionPorts['output']['admit']>>;

export type InvocationOutputCall =
  | { readonly type: 'admit'; readonly request: OutputAdmissionRequest }
  | { readonly type: 'record-terminal-result'; readonly outcome: NormalizedInvocationOutcome }
  | { readonly type: 'publish-terminal-result'; readonly result: AgentInvocationResult }
  | { readonly type: 'publish-raw-response'; readonly bytes: Uint8Array }
  | { readonly type: 'cleanup-scratch' }
  | { readonly type: 'append-lifecycle-event'; readonly event: AgentEvent }
  | { readonly type: 'record-event' };

export interface FakeInvocationOutputControls {
  enqueueAdmission(result: OutputAdmissionResult | (() => OutputAdmissionResult)): void;
  enqueueTerminalResultRecording(result?: Error): void;
  enqueuePendingTerminalResultRecording(): void;
  fulfilPendingTerminalResultRecording(recordingId: number): void;
  rejectPendingTerminalResultRecording(recordingId: number, error: Error): void;
  enqueueEventRecording(result?: Error): void;
  calls(): readonly InvocationOutputCall[];
  recordedTerminalResults(): readonly (AgentInvocationResult | NormalizedInvocationOutcome)[];
}

type InvocationOutputPort = InvocationExecutionPorts['output'];
type TerminalResultRecording = Error | undefined | 'pending';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

const deferred = (): Deferred => {
  let resolve: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (resolve === undefined || reject === undefined)
    throw new Error('Unable to create output deferred.');
  return { promise, resolve, reject };
};

type MutableJsonObject = { [key: string]: MutableJsonValue };
type MutableJsonValue = null | boolean | number | string | MutableJsonValue[] | MutableJsonObject;
type MutableJsonContainer = MutableJsonValue[] | MutableJsonObject;

interface CopyFrame {
  readonly source: JsonObject | readonly JsonValue[];
  readonly target: MutableJsonContainer;
}

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

const isJsonObject = (value: JsonValue): value is JsonObject => !isJsonArray(value);

const createContainer = (value: JsonObject | readonly JsonValue[]): MutableJsonContainer =>
  isJsonArray(value) ? [] : {};

const appendCopiedValue = (
  target: MutableJsonContainer,
  key: string,
  value: MutableJsonValue,
): void => {
  if (Array.isArray(target)) target.push(value);
  else Object.defineProperty(target, key, { enumerable: true, value, writable: true });
};

const copyJsonValue = (root: JsonValue): JsonValue => {
  if (root === null || typeof root !== 'object') return root;
  const copy = createContainer(root);
  const frames: CopyFrame[] = [Object.freeze({ source: root, target: copy })];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) continue;
    const entries = isJsonArray(frame.source)
      ? frame.source.map((value, index) => [String(index), value] as const)
      : Object.entries(frame.source);
    for (const [key, value] of entries) {
      if (value === null || typeof value !== 'object') {
        appendCopiedValue(frame.target, key, value);
        continue;
      }
      const child = createContainer(value);
      appendCopiedValue(frame.target, key, child);
      frames.push(Object.freeze({ source: value, target: child }));
    }
  }
  return copy;
};

const freezeJson = (root: JsonValue): void => {
  const frames: Array<Readonly<{ value: JsonValue; visited: boolean }>> = [
    Object.freeze({ value: root, visited: false }),
  ];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined || frame.value === null || typeof frame.value !== 'object') continue;
    if (frame.visited) {
      Object.freeze(frame.value);
      continue;
    }
    frames.push(Object.freeze({ value: frame.value, visited: true }));
    const children = isJsonArray(frame.value) ? frame.value : Object.values(frame.value);
    for (const child of children) frames.push(Object.freeze({ value: child, visited: false }));
  }
};

const copyEvidence = (evidence: NormalizedInvocationOutcome['evidence']) =>
  Object.freeze({
    ...(evidence.exit === undefined
      ? {}
      : {
          exit: Object.freeze({ exitCode: evidence.exit.exitCode, signal: evidence.exit.signal }),
        }),
    ...(evidence.usage === undefined ? {} : { usage: Object.freeze({ ...evidence.usage }) }),
    ...(evidence.rawResponse === undefined ? {} : { rawResponse: evidence.rawResponse }),
    ...(evidence.rawFinalResponseEligibility === undefined
      ? {}
      : { rawFinalResponseEligibility: evidence.rawFinalResponseEligibility }),
    ...(evidence.schemaDiagnostics === undefined
      ? {}
      : { schemaDiagnostics: evidence.schemaDiagnostics }),
  });

const copyFailure = (
  failure: Extract<NormalizedInvocationOutcome, { status: 'failed' }>['failure'],
) => {
  if (failure.kind === 'duplex')
    return Object.freeze({
      kind: 'duplex' as const,
      primary: Object.freeze({ ...failure.primary }),
      code: failure.code,
    });
  if (failure.kind === 'parser')
    return Object.freeze({ kind: 'parser' as const, reason: failure.reason, code: failure.code });
  if (failure.kind === 'result_schema')
    return Object.freeze({
      kind: 'result_schema' as const,
      code: failure.code,
      ...(failure.diagnostics === undefined ? {} : { diagnostics: failure.diagnostics }),
    });
  return Object.freeze({ kind: 'finalization' as const, code: failure.code });
};

const copyOutcome = (outcome: NormalizedInvocationOutcome): NormalizedInvocationOutcome => {
  const evidence = copyEvidence(outcome.evidence);
  if (outcome.status === 'succeeded') {
    const value = copyJsonValue(outcome.value);
    if (value === null || typeof value !== 'object' || !isJsonObject(value))
      throw new Error('Expected a copied JSON object.');
    freezeJson(value);
    return Object.freeze({ status: 'succeeded', value, evidence });
  }
  if (outcome.status === 'failed')
    return Object.freeze({ status: 'failed', failure: copyFailure(outcome.failure), evidence });
  return Object.freeze({ status: outcome.status, evidence });
};

export class FakeInvocationOutputPort
  implements InvocationOutputPort, FakeInvocationOutputControls
{
  private readonly admissionQueue: Array<OutputAdmissionResult | (() => OutputAdmissionResult)> =
    [];
  private readonly terminalResultRecordingQueue: TerminalResultRecording[] = [];
  private readonly pendingTerminalResultRecordings = new Map<number, Deferred>();
  private readonly eventRecordingQueue: (Error | undefined)[] = [];
  private readonly callLog: InvocationOutputCall[] = [];
  private readonly terminalResults: Array<AgentInvocationResult | NormalizedInvocationOutcome> = [];
  private nextPendingTerminalResultRecordingId = 1;

  enqueueAdmission(result: OutputAdmissionResult | (() => OutputAdmissionResult)): void {
    this.admissionQueue.push(result);
  }

  enqueueTerminalResultRecording(result?: Error): void {
    this.terminalResultRecordingQueue.push(result);
  }

  enqueuePendingTerminalResultRecording(): void {
    this.terminalResultRecordingQueue.push('pending');
  }

  fulfilPendingTerminalResultRecording(recordingId: number): void {
    const pending = this.pendingTerminalResultRecording(recordingId);
    this.pendingTerminalResultRecordings.delete(recordingId);
    pending.resolve();
  }

  rejectPendingTerminalResultRecording(recordingId: number, error: Error): void {
    const pending = this.pendingTerminalResultRecording(recordingId);
    this.pendingTerminalResultRecordings.delete(recordingId);
    pending.reject(error);
  }

  enqueueEventRecording(result?: Error): void {
    this.eventRecordingQueue.push(result);
  }

  async admit(request: OutputAdmissionRequest): Promise<OutputAdmissionResult> {
    const copiedRequest = Object.freeze({ ...request });
    this.record(Object.freeze({ type: 'admit', request: copiedRequest }));
    const result = this.admissionQueue.shift();
    if (result === undefined) return Object.freeze({ status: 'admitted', plan: copiedRequest });
    return typeof result === 'function' ? result() : result;
  }

  async recordTerminalResult(outcome: NormalizedInvocationOutcome): Promise<void> {
    const copiedOutcome = copyOutcome(outcome);
    this.record(Object.freeze({ type: 'record-terminal-result', outcome: copiedOutcome }));
    const queued = this.takeTerminalResultRecording(
      this.terminalResultRecordingQueue,
      'terminal-result recording',
    );
    if (queued === 'pending') {
      const recordingId = this.nextPendingTerminalResultRecordingId;
      this.nextPendingTerminalResultRecordingId += 1;
      const pending = deferred();
      this.pendingTerminalResultRecordings.set(recordingId, pending);
      await pending.promise;
    } else {
      this.complete(queued);
    }
    this.terminalResults.push(copiedOutcome);
  }

  async publishTerminalResult(
    _authority: TerminalPublicationAuthority,
    result: AgentInvocationResult,
  ): Promise<TerminalResultPublicationResult> {
    this.record(Object.freeze({ type: 'publish-terminal-result', result }));
    const queued = this.takeTerminalResultRecording(
      this.terminalResultRecordingQueue,
      'terminal-result recording',
    );
    if (queued === 'pending') {
      const recordingId = this.nextPendingTerminalResultRecordingId;
      this.nextPendingTerminalResultRecordingId += 1;
      const pending = deferred();
      this.pendingTerminalResultRecordings.set(recordingId, pending);
      await pending.promise;
    } else if (queued instanceof Error) {
      return Object.freeze({ status: 'write_failed' as const });
    }
    this.terminalResults.push(result);
    return Object.freeze({ status: 'published' as const, file: 'result.json' as const });
  }

  async appendLifecycleEvent(
    _authority: TerminalPublicationAuthority,
    event: AgentEvent,
  ): Promise<{ readonly status: 'appended' }> {
    this.record(Object.freeze({ type: 'append-lifecycle-event', event }));
    this.complete(this.take(this.eventRecordingQueue, 'event recording'));
    return Object.freeze({ status: 'appended' as const });
  }

  async publishRawResponse(
    _authority: TerminalPublicationAuthority,
    _eligibility: RawFinalResponseEligibility,
    bytes: Uint8Array,
  ): Promise<RawResponsePublicationResult> {
    this.record(Object.freeze({ type: 'publish-raw-response', bytes: new Uint8Array(bytes) }));
    return Object.freeze({ status: 'published' as const, file: 'raw-final-response.txt' as const });
  }

  async cleanupScratch(_authority: TerminalPublicationAuthority): Promise<ScratchCleanupResult> {
    this.record(Object.freeze({ type: 'cleanup-scratch' as const }));
    return Object.freeze({ status: 'absent' as const });
  }

  async recordEvent(): Promise<void> {
    this.record(Object.freeze({ type: 'record-event' }));
    this.complete(this.take(this.eventRecordingQueue, 'event recording'));
  }

  calls(): readonly InvocationOutputCall[] {
    return Object.freeze(this.callLog.map((call) => copyOutcomeCall(call)));
  }

  recordedTerminalResults(): readonly (AgentInvocationResult | NormalizedInvocationOutcome)[] {
    return Object.freeze([...this.terminalResults]);
  }

  private pendingTerminalResultRecording(recordingId: number): Deferred {
    const pending = this.pendingTerminalResultRecordings.get(recordingId);
    if (pending === undefined)
      throw new Error(`Unknown pending terminal-result recording ${recordingId}`);
    return pending;
  }

  private takeTerminalResultRecording(
    queue: TerminalResultRecording[],
    operation: string,
  ): TerminalResultRecording {
    if (queue.length === 0) throw new Error(`No ${operation} outcome is queued`);
    return queue.shift();
  }

  private take(queue: (Error | undefined)[], operation: string): Error | undefined {
    if (queue.length === 0) throw new Error(`No ${operation} outcome is queued`);
    return queue.shift();
  }

  private complete(result: Error | undefined): void {
    if (result instanceof Error) throw result;
  }

  private record(call: InvocationOutputCall): void {
    this.callLog.push(call);
  }
}

const copyOutcomeCall = (call: InvocationOutputCall): InvocationOutputCall => {
  if (call.type === 'record-terminal-result')
    return Object.freeze({ type: call.type, outcome: copyOutcome(call.outcome) });
  if (call.type === 'admit') return Object.freeze({ type: call.type, request: call.request });
  if (call.type === 'publish-raw-response')
    return Object.freeze({ type: call.type, bytes: new Uint8Array(call.bytes) });
  if (call.type === 'publish-terminal-result')
    return Object.freeze({ type: call.type, result: call.result });
  if (call.type === 'append-lifecycle-event')
    return Object.freeze({ type: call.type, event: call.event });
  return Object.freeze({ type: call.type });
};
