import type {
  LiveOwnedProcess,
  ProcessExitObservation,
  ProcessIdentity,
  ProcessStartRequest,
  ProcessSupervisionPort,
} from '../../../src/runtime/execution/index.js';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

interface PendingProcess {
  readonly completion: Deferred<ProcessExitObservation>;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to create a process completion.');

  return Object.freeze({ promise, resolve });
};

const copyIdentity = (identity: ProcessIdentity): ProcessIdentity =>
  Object.freeze({
    pid: identity.pid,
    processGroupId: identity.processGroupId,
    fingerprint: identity.fingerprint,
  });

const fakeInputSink = Object.freeze({
  write: async (_chunk: Uint8Array): Promise<void> => undefined,
  end: async (): Promise<void> => undefined,
  abort: async (): Promise<void> => undefined,
});

const copyRequest = (request: ProcessStartRequest): ProcessStartRequest =>
  Object.freeze({
    cwd: request.cwd,
    executable: request.executable,
    args: Object.freeze([...request.args]),
    environment: Object.freeze({ ...request.environment }),
    shell: request.shell,
    stdout: request.stdout,
    stderr: request.stderr,
  });

export class FakeProcessSupervisionPort implements ProcessSupervisionPort {
  private readonly callsValue: ProcessStartRequest[] = [];
  private readonly pending = new Map<number, PendingProcess>();
  private readonly starts: ProcessIdentity[] = [];
  private nextId = 1;

  enqueueStart(identity: ProcessIdentity): void {
    this.starts.push(copyIdentity(identity));
  }

  async start(request: ProcessStartRequest): Promise<LiveOwnedProcess> {
    this.callsValue.push(copyRequest(request));
    const identity = this.starts.shift();
    if (identity === undefined) throw new Error('No process start is queued.');

    const completion = deferred<ProcessExitObservation>();
    const id = this.nextId;
    this.nextId += 1;
    this.pending.set(id, Object.freeze({ completion }));
    return Object.freeze({
      spawnedAt: Date.now(),
      identity,
      stdin: fakeInputSink,
      completion: completion.promise,
      terminateAndReap: async () => {
        const pending = this.pending.get(id);
        if (pending === undefined) return;

        this.pending.delete(id);
        pending.completion.resolve(Object.freeze({ exitCode: 0, signal: null }));
      },
    });
  }

  calls(): readonly ProcessStartRequest[] {
    return Object.freeze([...this.callsValue]);
  }

  settle(id: number): void {
    const pending = this.pending.get(id);
    if (pending === undefined) throw new Error(`Unknown process id ${id}`);

    this.pending.delete(id);
    pending.completion.resolve(Object.freeze({ exitCode: 0, signal: null }));
  }
}
