import type { InvocationExecutionPorts } from '../../../src/runtime/execution/index.js';

export type InvocationOutputCall =
  | { readonly type: 'prepare' }
  | { readonly type: 'record-terminal-result' }
  | { readonly type: 'record-event' };

export interface FakeInvocationOutputControls {
  enqueuePrepare(result?: Error): void;
  enqueueTerminalResultRecording(result?: Error): void;
  enqueueEventRecording(result?: Error): void;
  calls(): readonly InvocationOutputCall[];
}

type InvocationOutputPort = InvocationExecutionPorts['output'];

export class FakeInvocationOutputPort
  implements InvocationOutputPort, FakeInvocationOutputControls
{
  private readonly prepareQueue: (Error | undefined)[] = [];
  private readonly terminalResultRecordingQueue: (Error | undefined)[] = [];
  private readonly eventRecordingQueue: (Error | undefined)[] = [];
  private readonly callLog: InvocationOutputCall[] = [];

  enqueuePrepare(result?: Error): void {
    this.prepareQueue.push(result);
  }

  enqueueTerminalResultRecording(result?: Error): void {
    this.terminalResultRecordingQueue.push(result);
  }

  enqueueEventRecording(result?: Error): void {
    this.eventRecordingQueue.push(result);
  }

  async prepare(): Promise<void> {
    this.record(Object.freeze({ type: 'prepare' }));
    this.complete(this.take(this.prepareQueue, 'prepare'));
  }

  async recordTerminalResult(): Promise<void> {
    this.record(Object.freeze({ type: 'record-terminal-result' }));
    this.complete(this.take(this.terminalResultRecordingQueue, 'terminal-result recording'));
  }

  async recordEvent(): Promise<void> {
    this.record(Object.freeze({ type: 'record-event' }));
    this.complete(this.take(this.eventRecordingQueue, 'event recording'));
  }

  calls(): readonly InvocationOutputCall[] {
    return Object.freeze(
      this.callLog.map((call) => {
        if (call.type === 'prepare') {
          return Object.freeze({ type: 'prepare' } as const);
        }
        if (call.type === 'record-terminal-result') {
          return Object.freeze({ type: 'record-terminal-result' } as const);
        }

        return Object.freeze({ type: 'record-event' } as const);
      }),
    );
  }

  private take(queue: (Error | undefined)[], operation: string): Error | undefined {
    if (queue.length === 0) {
      throw new Error(`No ${operation} outcome is queued`);
    }

    return queue.shift();
  }

  private complete(result: Error | undefined): void {
    if (result instanceof Error) {
      throw result;
    }
  }

  private record(call: InvocationOutputCall): void {
    this.callLog.push(call);
  }
}
