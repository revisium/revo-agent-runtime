import {
  InvocationInputSnapshot,
  InvocationLifecycle,
  type InvocationExecutionPorts,
} from '../../runtime/execution/index.js';

type RejectionReason = 'invalid_request' | 'duplicate_invocation' | 'output_prepare_failed';
type LifecycleStartOutcome =
  | Readonly<{ status: 'rejected'; reason: RejectionReason }>
  | Readonly<{ status: 'accepted'; lifecycle: InvocationLifecycle }>;

class InternalInvocationLifecycleManager {
  private readonly activeIds = new Set<string>();

  constructor(private readonly ports: InvocationExecutionPorts) {}

  async start(input: unknown): Promise<LifecycleStartOutcome> {
    const snapshot = InvocationInputSnapshot.create(input);
    if (snapshot === undefined)
      return Object.freeze({ status: 'rejected', reason: 'invalid_request' });
    try {
      await this.ports.output.prepare();
    } catch {
      return Object.freeze({ status: 'rejected', reason: 'output_prepare_failed' });
    }
    if (this.activeIds.has(snapshot.invocationId))
      return Object.freeze({ status: 'rejected', reason: 'duplicate_invocation' });
    this.activeIds.add(snapshot.invocationId);
    const lifecycle = new InvocationLifecycle(this.ports, snapshot, () => {
      this.activeIds.delete(snapshot.invocationId);
    });
    lifecycle.begin();
    return Object.freeze({ status: 'accepted', lifecycle });
  }
}

export const createInvocationLifecycleManager = (
  ports: InvocationExecutionPorts,
): Readonly<{ start(input: unknown): Promise<LifecycleStartOutcome> }> =>
  Object.freeze(new InternalInvocationLifecycleManager(ports));
