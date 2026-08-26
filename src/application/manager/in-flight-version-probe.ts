import type { ProcessCleanupAttemptOutcome } from '../../runtime/execution/index.js';
import type {
  ExecutableProbePort,
  RunningVersionProbe,
  VersionProbeRequest,
} from '../../runtime/probe/index.js';

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const refusedProbe = (): RunningVersionProbe =>
  Object.freeze({
    completion: Promise.resolve(Object.freeze({ status: 'spawn_failed' as const })),
    timeout: new Promise<void>(() => undefined),
    terminateAndReap: () => Promise.resolve(undefined),
  });

export class InFlightVersionProbe {
  readonly supervisedPort: ExecutableProbePort;
  private readonly handleReady = deferred<RunningVersionProbe | undefined>();
  private readonly isClosing: () => boolean;
  private readonly realPort: ExecutableProbePort;
  private running: RunningVersionProbe | undefined;
  private termination: Promise<ProcessCleanupAttemptOutcome | undefined> | undefined;
  private outcome: ProcessCleanupAttemptOutcome | undefined;
  private terminationRequested = false;

  constructor(realPort: ExecutableProbePort, isClosing: () => boolean) {
    this.realPort = realPort;
    this.isClosing = isClosing;
    this.supervisedPort = Object.freeze({
      hostPlatform: () => this.realPort.hostPlatform(),
      resolveExecutable: (request: Readonly<{ command: string }>) =>
        this.realPort.resolveExecutable(request),
      startVersionProbe: (request: VersionProbeRequest) => this.start(request),
    });
  }

  requestTermination(): void {
    this.terminationRequested = true;
    this.beginTermination();
  }

  async terminationSettled(): Promise<void> {
    if (!this.terminationRequested) return;
    await this.handleReady.promise;
    await this.termination;
  }

  terminationOutcome(): ProcessCleanupAttemptOutcome | undefined {
    return this.outcome;
  }

  private async start(request: VersionProbeRequest): Promise<RunningVersionProbe> {
    if (this.isClosing()) {
      const refused = refusedProbe();
      this.handleReady.resolve(refused);
      return refused;
    }

    let running: RunningVersionProbe;
    try {
      running = await this.realPort.startVersionProbe(request);
    } catch (error: unknown) {
      this.handleReady.resolve(undefined);
      throw error;
    }
    this.running = running;
    const supervised = Object.freeze({
      completion: running.completion,
      timeout: running.timeout,
      terminateAndReap: () => {
        this.terminationRequested = true;
        this.beginTermination();
        return this.termination ?? Promise.resolve(undefined);
      },
    });
    this.handleReady.resolve(supervised);
    if (this.isClosing()) this.requestTermination();
    return supervised;
  }

  private beginTermination(): void {
    if (!this.terminationRequested || this.running === undefined || this.termination !== undefined)
      return;
    this.termination = this.running.terminateAndReap().then(
      (outcome) => {
        this.outcome = outcome;
        return outcome;
      },
      () => {
        const outcome = Object.freeze({
          cause: 'termination_rejected' as const,
          termSent: false,
          killSent: false,
          lastKnownGroupState: 'unknown' as const,
          leaderReapState: 'unknown' as const,
        });
        this.outcome = outcome;
        return outcome;
      },
    );
  }
}
