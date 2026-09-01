import type {
  AgentExecutionPin,
  AgentInvocationFilter,
  AgentInvocationResult,
  AgentInvocationSnapshot,
  AgentInvocationStatus,
  AgentResultLookup,
  StartAgentInvocation,
} from '../../contracts/manager.js';
import { managerError } from '../faults/agent-faults.js';
import { readClosedArray, readDataProperty, readExactAgentRef } from './public-filter-input.js';

interface ActiveInvocationRecord {
  readonly acceptedAt: string;
  readonly invocationId: string;
  readonly metadata?: Record<string, unknown>;
  readonly outputDirectory: string;
  readonly pin: AgentExecutionPin;
  readonly result: Promise<AgentInvocationResult>;
  startedAt?: string;
  status: AgentInvocationStatus;
}

interface CompletedInvocationRecord {
  readonly result: AgentInvocationResult;
  readonly snapshot: AgentInvocationSnapshot & Readonly<{ readonly finishedAt: string }>;
}

const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareSnapshots = (
  left: AgentInvocationSnapshot,
  right: AgentInvocationSnapshot,
): number => {
  const acceptedAtOrder = compareStrings(left.acceptedAt, right.acceptedAt);
  return acceptedAtOrder === 0
    ? compareStrings(left.invocationId, right.invocationId)
    : acceptedAtOrder;
};

const compareCompletedRecords = (
  left: CompletedInvocationRecord,
  right: CompletedInvocationRecord,
): number => {
  const finishedAtOrder = compareStrings(left.snapshot.finishedAt, right.snapshot.finishedAt);
  return finishedAtOrder === 0
    ? compareStrings(left.snapshot.invocationId, right.snapshot.invocationId)
    : finishedAtOrder;
};

const invocationStatuses = new Set<string>([
  'accepted',
  'starting',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

const isInvocationStatus = (value: unknown): value is AgentInvocationStatus =>
  typeof value === 'string' && invocationStatuses.has(value);

const snapshotFilter = (
  value: AgentInvocationFilter | undefined,
): AgentInvocationFilter | undefined => {
  if (value === undefined) return undefined;
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Reflect.ownKeys(value).some(
        (key) => key !== 'agent' && key !== 'invocationId' && key !== 'statuses',
      )
    )
      throw new TypeError('Invalid invocation filter.');
    const agentProperty = readDataProperty(value, 'agent');
    const invocationIdProperty = readDataProperty(value, 'invocationId');
    const statusesProperty = readDataProperty(value, 'statuses');
    const agent =
      agentProperty.status === 'present' ? readExactAgentRef(agentProperty.value) : undefined;
    const statuses =
      statusesProperty.status === 'present'
        ? readClosedArray(statusesProperty.value, isInvocationStatus)
        : undefined;
    const invocationId =
      invocationIdProperty.status === 'present' ? invocationIdProperty.value : undefined;
    if (
      agentProperty.status === 'invalid' ||
      invocationIdProperty.status === 'invalid' ||
      statusesProperty.status === 'invalid' ||
      (agentProperty.status === 'present' && agent === undefined) ||
      (statusesProperty.status === 'present' && statuses === undefined) ||
      (invocationIdProperty.status === 'present' && typeof invocationId !== 'string')
    )
      throw new TypeError('Invalid invocation filter.');
    return Object.freeze({
      ...(agent === undefined ? {} : { agent }),
      ...(typeof invocationId === 'string' ? { invocationId } : {}),
      ...(statuses === undefined ? {} : { statuses }),
    });
  } catch {
    throw managerError('revo.agent.internal', 'Agent invocation filter is invalid.');
  }
};

const matchesFilter = (
  snapshot: AgentInvocationSnapshot,
  filter: AgentInvocationFilter | undefined,
): boolean => {
  if (filter?.invocationId !== undefined && filter.invocationId !== snapshot.invocationId)
    return false;
  if (
    filter?.agent !== undefined &&
    (filter.agent.id !== snapshot.pin.agentId || filter.agent.version !== snapshot.pin.agentVersion)
  )
    return false;
  return filter?.statuses === undefined || filter.statuses.includes(snapshot.status);
};

const activeSnapshot = (record: ActiveInvocationRecord): AgentInvocationSnapshot =>
  Object.freeze({
    acceptedAt: record.acceptedAt,
    invocationId: record.invocationId,
    ...(record.metadata === undefined ? {} : { metadata: record.metadata }),
    outputDirectory: record.outputDirectory,
    pin: record.pin,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    status: record.status,
  });

const completedSnapshot = (
  active: ActiveInvocationRecord,
  result: AgentInvocationResult,
  finishedAt: string,
): AgentInvocationSnapshot & Readonly<{ readonly finishedAt: string }> =>
  Object.freeze({
    ...activeSnapshot(active),
    finishedAt,
    status: result.status,
  });

export class InvocationQueries {
  private readonly active = new Map<string, ActiveInvocationRecord>();
  private readonly completed = new Map<string, CompletedInvocationRecord>();

  constructor(private readonly capacity: number) {}

  has(invocationId: string): boolean {
    return this.active.has(invocationId) || this.completed.has(invocationId);
  }

  accept(
    request: StartAgentInvocation,
    pin: AgentExecutionPin,
    acceptedAt: string,
    result: Promise<AgentInvocationResult>,
  ): void {
    this.active.set(request.invocationId, {
      acceptedAt,
      invocationId: request.invocationId,
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
      outputDirectory: request.output.directory,
      pin,
      result,
      status: 'accepted',
    });
  }

  markStarted(invocationId: string, startedAt: string): void {
    const record = this.active.get(invocationId);
    if (record === undefined) return;
    record.startedAt = startedAt;
    record.status = 'running';
  }

  markCancelling(invocationId: string): void {
    const record = this.active.get(invocationId);
    if (record !== undefined) record.status = 'cancelling';
  }

  complete(invocationId: string, result: AgentInvocationResult, finishedAt: string): void {
    const active = this.active.get(invocationId);
    if (active === undefined) return;
    this.active.delete(invocationId);
    this.completed.set(
      invocationId,
      Object.freeze({ result, snapshot: completedSnapshot(active, result, finishedAt) }),
    );
    while (this.completed.size > this.capacity) {
      const first = this.completed.values().next().value!;
      const oldest = [...this.completed.values()].reduce(
        (previous, current) =>
          compareCompletedRecords(current, previous) < 0 ? current : previous,
        first,
      );
      this.completed.delete(oldest.snapshot.invocationId);
    }
  }

  getInvocation(invocationId: string): AgentInvocationSnapshot | undefined {
    const active = this.active.get(invocationId);
    return active === undefined
      ? this.completed.get(invocationId)?.snapshot
      : activeSnapshot(active);
  }

  listInvocations(filter?: AgentInvocationFilter): readonly AgentInvocationSnapshot[] {
    const ownedFilter = snapshotFilter(filter);
    const snapshots = [
      ...[...this.active.values()].map(activeSnapshot),
      ...[...this.completed.values()].map(({ snapshot }) => snapshot),
    ];
    return Object.freeze(
      snapshots
        .filter((snapshot) => matchesFilter(snapshot, ownedFilter))
        .toSorted(compareSnapshots),
    );
  }

  getResult(invocationId: string): AgentResultLookup {
    const active = this.active.get(invocationId);
    if (active !== undefined)
      return Object.freeze({ invocation: activeSnapshot(active), state: 'running' });
    const completed = this.completed.get(invocationId);
    return completed === undefined
      ? Object.freeze({ state: 'unknown' })
      : Object.freeze({ result: completed.result, state: 'completed' });
  }

  waitForResult(invocationId: string): Promise<AgentInvocationResult> {
    const active = this.active.get(invocationId);
    if (active !== undefined) return active.result;
    const completed = this.completed.get(invocationId);
    if (completed !== undefined) return Promise.resolve(completed.result);
    return Promise.reject(
      managerError('revo.agent.invocation_unknown', 'Agent invocation id is unknown.'),
    );
  }
}
