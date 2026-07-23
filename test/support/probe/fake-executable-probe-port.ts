import type {
  ExecutableProbePort,
  ExecutableResolution,
  ProbeHostPlatform,
  RunningVersionProbe,
  VersionProbeObservation,
  VersionProbeRequest,
} from '../../../src/runtime/probe/index.js';

export type ProbePortCall =
  | { readonly type: 'resolve'; readonly command: string }
  | ({ readonly type: 'start-version' } & VersionProbeRequest)
  | { readonly type: 'terminate-and-reap'; readonly probeId: number };

export interface FakeExecutableProbeControls {
  enqueueResolution(result: ExecutableResolution | Error): void;
  enqueueVersionStart(result: 'running' | Error): void;
  settleCompletion(probeId: number, observation: VersionProbeObservation | Error): void;
  fireTimeout(probeId: number): void;
  settleTermination(probeId: number, result?: Error): void;
  calls(): readonly ProbePortCall[];
  hostPlatformReadCount(): number;
  activeVersionProbes(): number;
  maximumActiveVersionProbes(): number;
}

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (reason: Error) => void;
}

interface PendingProbe {
  readonly completion: Deferred<VersionProbeObservation>;
  readonly timeout: Deferred<void>;
  termination: Deferred<void> | undefined;
  completionSettled: boolean;
  timeoutSettled: boolean;
  terminationSettled: boolean;
  active: boolean;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  if (resolve === undefined || reject === undefined) {
    throw new Error('Unable to create a deferred test helper');
  }

  return { promise, resolve, reject };
};

const copyObservation = (observation: VersionProbeObservation): VersionProbeObservation => {
  if (observation.status === 'spawn_failed') {
    return Object.freeze({ status: 'spawn_failed' });
  }

  return Object.freeze({
    status: 'exited',
    exitCode: observation.exitCode,
    signal: observation.signal,
    stdout: new Uint8Array(observation.stdout),
    stderr: new Uint8Array(observation.stderr),
    overflow: observation.overflow,
  });
};

export class FakeExecutableProbePort implements ExecutableProbePort, FakeExecutableProbeControls {
  readonly #platform: ProbeHostPlatform;
  readonly #resolutionQueue: (ExecutableResolution | Error)[] = [];
  readonly #versionStartQueue: ('running' | Error)[] = [];
  readonly #probes = new Map<number, PendingProbe>();
  readonly #callLog: ProbePortCall[] = [];
  #hostPlatformReadCount = 0;
  #nextProbeId = 1;
  #activeProbeCount = 0;
  #maximumActiveProbeCount = 0;

  constructor({ platform }: Readonly<{ platform: ProbeHostPlatform }>) {
    this.#platform = platform;
  }

  hostPlatform(): ProbeHostPlatform {
    this.#hostPlatformReadCount += 1;
    return this.#platform;
  }

  enqueueResolution(result: ExecutableResolution | Error): void {
    this.#resolutionQueue.push(result);
  }

  enqueueVersionStart(result: 'running' | Error): void {
    this.#versionStartQueue.push(result);
  }

  async resolveExecutable(request: Readonly<{ command: string }>): Promise<ExecutableResolution> {
    this.#record(Object.freeze({ type: 'resolve', command: request.command }));
    const result = this.#take(this.#resolutionQueue, 'resolution');

    if (result instanceof Error) {
      throw result;
    }

    return result;
  }

  async startVersionProbe(request: VersionProbeRequest): Promise<RunningVersionProbe> {
    this.#record(
      Object.freeze({
        type: 'start-version',
        executable: request.executable,
        args: Object.freeze([...request.args]),
        shell: request.shell,
        timeoutMs: request.timeoutMs,
        stdoutLimitBytes: request.stdoutLimitBytes,
        stderrLimitBytes: request.stderrLimitBytes,
      }),
    );
    const result = this.#take(this.#versionStartQueue, 'version start');

    if (result instanceof Error) {
      throw result;
    }

    const probeId = this.#nextProbeId;
    this.#nextProbeId += 1;
    const pendingProbe: PendingProbe = {
      completion: deferred<VersionProbeObservation>(),
      timeout: deferred<void>(),
      termination: undefined,
      completionSettled: false,
      timeoutSettled: false,
      terminationSettled: false,
      active: true,
    };
    this.#probes.set(probeId, pendingProbe);
    this.#activeProbeCount += 1;
    this.#maximumActiveProbeCount = Math.max(this.#maximumActiveProbeCount, this.#activeProbeCount);

    return {
      completion: pendingProbe.completion.promise,
      timeout: pendingProbe.timeout.promise,
      terminateAndReap: () => this.#terminateAndReap(probeId),
    };
  }

  settleCompletion(probeId: number, observation: VersionProbeObservation | Error): void {
    const probe = this.#probe(probeId);
    if (probe.completionSettled) {
      throw new Error(`Completion for probe ${probeId} is already settled`);
    }

    probe.completionSettled = true;
    this.#release(probe);
    if (observation instanceof Error) {
      probe.completion.reject(observation);
      return;
    }

    probe.completion.resolve(copyObservation(observation));
  }

  fireTimeout(probeId: number): void {
    const probe = this.#probe(probeId);
    if (probe.timeoutSettled) {
      throw new Error(`Timeout for probe ${probeId} is already settled`);
    }

    probe.timeoutSettled = true;
    probe.timeout.resolve(undefined);
  }

  settleTermination(probeId: number, result?: Error): void {
    const probe = this.#probe(probeId);
    if (probe.termination === undefined) {
      throw new Error(`Termination for probe ${probeId} has not started`);
    }
    if (probe.terminationSettled) {
      throw new Error(`Termination for probe ${probeId} is already settled`);
    }

    probe.terminationSettled = true;
    if (result === undefined) {
      this.#release(probe);
      probe.termination.resolve(undefined);
      return;
    }

    probe.termination.reject(result);
  }

  calls(): readonly ProbePortCall[] {
    return Object.freeze([...this.#callLog]);
  }

  hostPlatformReadCount(): number {
    return this.#hostPlatformReadCount;
  }

  activeVersionProbes(): number {
    return this.#activeProbeCount;
  }

  maximumActiveVersionProbes(): number {
    return this.#maximumActiveProbeCount;
  }

  #terminateAndReap(probeId: number): Promise<void> {
    const probe = this.#probe(probeId);
    this.#record(Object.freeze({ type: 'terminate-and-reap', probeId }));
    if (probe.termination === undefined) {
      probe.termination = deferred<void>();
    }

    return probe.termination.promise;
  }

  #take<Result>(queue: Result[], name: string): Result {
    const result = queue.shift();
    if (result === undefined) {
      throw new Error(`No ${name} result is queued`);
    }

    return result;
  }

  #record(call: ProbePortCall): void {
    this.#callLog.push(call);
  }

  #probe(probeId: number): PendingProbe {
    const probe = this.#probes.get(probeId);
    if (probe === undefined) {
      throw new Error(`Unknown probe id ${probeId}`);
    }

    return probe;
  }

  #release(probe: PendingProbe): void {
    if (!probe.active) {
      return;
    }

    probe.active = false;
    this.#activeProbeCount -= 1;
  }
}
