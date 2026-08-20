import type {
  InvocationExecutionPorts,
  NormalizedInvocationOutcome,
} from '../../../src/runtime/execution/index.js';
import type { JsonObject, JsonValue } from '../../../src/runtime/spec/index.js';

type OutputAdmissionRequest = Parameters<InvocationExecutionPorts['output']['admit']>[0];
type OutputAdmissionResult = Awaited<ReturnType<InvocationExecutionPorts['output']['admit']>>;

export type InvocationOutputCall =
  | { readonly type: 'admit'; readonly request: OutputAdmissionRequest }
  | { readonly type: 'record-terminal-result'; readonly outcome: NormalizedInvocationOutcome }
  | { readonly type: 'record-event' };

export interface FakeInvocationOutputControls {
  enqueueAdmission(result: OutputAdmissionResult | (() => OutputAdmissionResult)): void;
  enqueueTerminalResultRecording(result?: Error): void;
  enqueuePendingTerminalResultRecording(): void;
  fulfilPendingTerminalResultRecording(recordingId: number): void;
  rejectPendingTerminalResultRecording(recordingId: number, error: Error): void;
  enqueueEventRecording(result?: Error): void;
  calls(): readonly InvocationOutputCall[];
  recordedTerminalResults(): readonly NormalizedInvocationOutcome[];
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

const copyDiagnostics = (
  diagnostics: Extract<NormalizedInvocationOutcome, { status: 'failed' }>['diagnostics'],
) => {
  if (diagnostics === undefined) return undefined;
  return Object.freeze({
    diagnostics: Object.freeze(
      diagnostics.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })),
    ),
    truncated: diagnostics.truncated,
  });
};

const copyOutcome = (outcome: NormalizedInvocationOutcome): NormalizedInvocationOutcome => {
  if (outcome.status === 'succeeded') {
    const value = copyJsonValue(outcome.value);
    if (value === null || typeof value !== 'object' || !isJsonObject(value))
      throw new Error('Expected a copied JSON object.');
    freezeJson(value);
    return Object.freeze({ status: 'succeeded', value });
  }
  if (outcome.status === 'failed') {
    const diagnostics = copyDiagnostics(outcome.diagnostics);
    const rawResponse =
      outcome.rawResponse === undefined ? undefined : Object.freeze({ ...outcome.rawResponse });
    return Object.freeze({
      status: 'failed',
      reason: outcome.reason,
      ...(diagnostics === undefined ? {} : { diagnostics }),
      ...(rawResponse === undefined ? {} : { rawResponse }),
    });
  }
  return Object.freeze({ status: outcome.status });
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
  private readonly terminalResults: NormalizedInvocationOutcome[] = [];
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
    const result = this.takeTerminalResultRecording(
      this.terminalResultRecordingQueue,
      'terminal-result recording',
    );
    if (result === 'pending') {
      const recordingId = this.nextPendingTerminalResultRecordingId;
      this.nextPendingTerminalResultRecordingId += 1;
      const pending = deferred();
      this.pendingTerminalResultRecordings.set(recordingId, pending);
      await pending.promise;
    } else {
      this.complete(result);
    }
    this.terminalResults.push(copiedOutcome);
  }

  async recordEvent(): Promise<void> {
    this.record(Object.freeze({ type: 'record-event' }));
    this.complete(this.take(this.eventRecordingQueue, 'event recording'));
  }

  calls(): readonly InvocationOutputCall[] {
    return Object.freeze(this.callLog.map((call) => copyOutcomeCall(call)));
  }

  recordedTerminalResults(): readonly NormalizedInvocationOutcome[] {
    return Object.freeze(this.terminalResults.map((outcome) => copyOutcome(outcome)));
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
  return Object.freeze({ type: call.type });
};
