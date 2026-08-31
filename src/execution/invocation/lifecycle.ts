import type { ProtocolDriver, ProtocolSession } from '../../protocol/driver.js';
import { literalArguments } from '../process/literal-launch.js';
import { ProcessStartError, type OwnedProcess, type ProcessSpawner } from '../process/port.js';
import { InvocationArtifacts } from './artifacts.js';
import type {
  ExecutionAdmission,
  ExecutionDrainage,
  InvocationExecution,
  InvocationExecutionRequest,
} from './contracts.js';
import { observeProtocol } from './protocol-policy.js';
import { cancelProtocolSession, closeProtocolSession } from './session-operations.js';
import { TerminalArbiter, type ExecutionOutcome } from './terminal.js';

class InvocationLifecycle {
  private readonly admission = Promise.withResolvers<ExecutionAdmission>();
  private readonly activation = Promise.withResolvers<void>();
  private readonly completion = Promise.withResolvers<ExecutionOutcome>();
  private readonly drainage = Promise.withResolvers<ExecutionDrainage>();
  private readonly spawnCancellation = new AbortController();
  private readonly artifacts: InvocationArtifacts;
  private readonly terminal: TerminalArbiter;
  private activated = false;
  private cancellationNotified = false;

  constructor(
    private readonly processes: ProcessSpawner,
    private readonly protocol: ProtocolDriver,
    private readonly request: InvocationExecutionRequest,
  ) {
    this.artifacts = new InvocationArtifacts(request);
    this.terminal = new TerminalArbiter(request.wallClockTimeoutMs, request.idleTimeoutMs, () => {
      this.spawnCancellation.abort();
      this.notifyCancellation();
    });
  }

  start(): InvocationExecution {
    void this.run().catch(() => {
      this.commit({ status: 'failed' });
      this.drainage.resolve({ status: 'cleanup_uncertain' });
    });
    return Object.freeze({
      activate: () => this.activate(),
      admission: this.admission.promise,
      cancel: () => this.commit({ status: 'cancelled' }),
      completion: this.completion.promise,
      drainage: this.drainage.promise,
      evidence: () => this.artifacts.evidence(),
      output: () => this.artifacts.output(),
    });
  }

  private async run(): Promise<void> {
    const args = literalArguments(this.request.definition);
    if (args === undefined) return this.rejectUnsupportedStrategy();

    const process = await this.spawn(args);
    if (process === undefined) return;

    const preacceptanceOutcome = this.terminal.current();
    if (preacceptanceOutcome !== undefined)
      return this.drainRejectedProcess(process, preacceptanceOutcome);

    void process.completion.then(() => this.commit({ status: 'failed' }));
    this.admission.resolve({
      identity: process.identity,
      launch: this.request.launch,
      status: 'accepted',
    });
    await this.activation.promise;
    this.notifyCancellation();
    this.terminal.observeActivity();

    const session =
      this.terminal.current() === undefined ? await this.openProtocolSession(process) : undefined;
    const outcome = await this.terminal.completion();
    if (
      (outcome.status === 'cancelled' || outcome.status === 'timed_out') &&
      this.request.definition.capabilities.cancellation &&
      session !== undefined
    )
      cancelProtocolSession(session);
    await closeProtocolSession(session);
    await this.finishAcceptedProcess(process, outcome);
  }

  private rejectUnsupportedStrategy(): void {
    const outcome = { status: 'failed' as const };
    this.commit(outcome);
    this.admission.resolve({ cleanup: 'confirmed', outcome, status: 'rejected' });
    this.completion.resolve(outcome);
    this.drainage.resolve({ outcome, status: 'terminal' });
  }

  private async spawn(args: readonly string[]): Promise<OwnedProcess | undefined> {
    try {
      return await this.processes.start(
        {
          args,
          command: this.request.launch.executable,
          cwd: this.request.workspace,
          environment: this.request.environment ?? {},
          onStderr: this.artifacts.writeStderr,
          onStdout: this.artifacts.writeStdout,
        },
        this.spawnCancellation.signal,
      );
    } catch (error) {
      const outcome = this.terminal.current() ?? ({ status: 'failed' } as const);
      this.commit(outcome);
      const cleanup = error instanceof ProcessStartError ? error.cleanup : 'confirmed';
      this.admission.resolve({ cleanup, outcome, status: 'rejected' });
      if (cleanup === 'confirmed') {
        this.completion.resolve(outcome);
        this.drainage.resolve({ outcome, status: 'terminal' });
      } else this.drainage.resolve({ status: 'cleanup_uncertain' });
      return undefined;
    }
  }

  private async drainRejectedProcess(
    process: OwnedProcess,
    outcome: ExecutionOutcome,
  ): Promise<void> {
    const cleanup = await process.terminateAndReap();
    if (cleanup.status === 'uncertain') {
      this.admission.resolve({ cleanup: 'uncertain', outcome, status: 'rejected' });
      this.drainage.resolve({ status: 'cleanup_uncertain' });
      return;
    }
    const evidence = this.artifacts.finalizeEvidence(this.request.launch, cleanup.exit);
    this.admission.resolve({
      cleanup: 'confirmed',
      evidence,
      outcome,
      status: 'rejected',
    });
    this.completion.resolve(outcome);
    this.drainage.resolve({ evidence, outcome, status: 'terminal' });
  }

  private async openProtocolSession(process: OwnedProcess): Promise<ProtocolSession | undefined> {
    const observation = observeProtocol(() => this.terminal.observeActivity(), {
      maxRawResponseBytes: this.request.maxRawResponseBytes ?? 1_048_576,
      resultSchema: this.request.resultSchema,
      secrets: this.request.redactionSecrets ?? [],
      usage: this.request.definition.capabilities.usage,
    });
    const opening = this.protocol
      .open({
        definition: this.request.definition,
        ...(this.request.configuration === undefined
          ? {}
          : { configuration: this.request.configuration }),
        observer: observation.observer,
        parameters: this.request.parameters,
        permissions: this.request.permissions,
        prompt: this.request.prompt,
        resultSchema: this.request.resultSchema,
        transport: process.transport,
        workspace: this.request.workspace,
      })
      .then(
        (opened) => ({ opened, status: 'opened' as const }),
        () => ({ status: 'failed' as const }),
      );
    const readiness = await Promise.race([
      opening,
      this.terminal.completion().then(() => ({ status: 'terminal' as const })),
    ]);
    if (readiness.status === 'opened') {
      void readiness.opened.completion.then(
        (outcome) => this.commit(observation.result(outcome)),
        () => this.commit({ status: 'failed' }),
      );
      return readiness.opened;
    }
    if (readiness.status === 'failed') this.commit({ status: 'failed' });
    else this.disposeLateSession(opening);
    return undefined;
  }

  private disposeLateSession(
    opening: Promise<
      | { readonly opened: ProtocolSession; readonly status: 'opened' }
      | { readonly status: 'failed' }
    >,
  ): void {
    void opening.then((late) => {
      if (late.status !== 'opened') return;
      if (this.request.definition.capabilities.cancellation) cancelProtocolSession(late.opened);
      void closeProtocolSession(late.opened);
    });
  }

  private async finishAcceptedProcess(
    process: OwnedProcess,
    outcome: ExecutionOutcome,
  ): Promise<void> {
    const cleanup = await process.terminateAndReap();
    if (cleanup.status === 'uncertain') {
      this.drainage.resolve({ status: 'cleanup_uncertain' });
      return;
    }
    const evidence = this.artifacts.finalizeEvidence(this.request.launch, cleanup.exit);
    this.artifacts.finalizeOutput();
    this.completion.resolve(outcome);
    this.drainage.resolve({ evidence, outcome, status: 'terminal' });
  }

  private activate(): void {
    if (this.activated) return;
    this.activated = true;
    if (this.terminal.current() === undefined) this.request.onStarted();
    this.notifyCancellation();
    this.activation.resolve();
  }

  private commit(candidate: ExecutionOutcome): boolean {
    const accepted = this.terminal.commit(candidate);
    if (!accepted) return false;
    this.spawnCancellation.abort();
    this.notifyCancellation();
    return true;
  }

  private notifyCancellation(): void {
    const outcome = this.terminal.current();
    if (
      this.cancellationNotified ||
      !this.activated ||
      (outcome?.status !== 'cancelled' && outcome?.status !== 'timed_out')
    )
      return;
    this.cancellationNotified = true;
    this.request.onCancelling();
  }
}

export const startInvocationLifecycle = (
  processes: ProcessSpawner,
  protocol: ProtocolDriver,
  request: InvocationExecutionRequest,
): InvocationExecution => new InvocationLifecycle(processes, protocol, request).start();
