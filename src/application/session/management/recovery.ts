import { AgentManagerError, type AgentDescriptor } from '../../../contracts/manager/core.js';
import type { ActiveAgentSessionStateSink } from '../../../contracts/session/persistence/active-state.js';
import type { RecoveredProcessInspector } from '../../../execution/process/port.js';
import { recoverySessionSnapshots } from './recovery-snapshots.js';

const unavailable = (): AgentManagerError =>
  new AgentManagerError({
    code: 'revo.agent.session_state_unavailable',
    message: 'Active session recovery could not be confirmed.',
    phase: 'session_recovery',
    retryable: false,
  });

const within = async <Value>(
  operation: (signal: AbortSignal) => Promise<Value>,
  timeoutMs: number,
  tracked: Promise<unknown>[],
): Promise<Value> => {
  const controller = new AbortController();
  let timer!: ReturnType<typeof setTimeout>;
  const pending = Promise.resolve().then(() => operation(controller.signal));
  tracked.push(pending.catch(() => undefined));
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(unavailable());
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

interface SessionRecoveryAttempt {
  readonly result: Promise<void>;
  readonly quiescence: Promise<void>;
}

type SessionRecoveryInput = Readonly<{
  readonly agents: readonly AgentDescriptor[];
  readonly inspector: RecoveredProcessInspector;
  readonly operationTimeoutMs: number;
  readonly recoveryTimeoutMs: number;
  readonly sink: ActiveAgentSessionStateSink;
  readonly snapshots: unknown;
}>;

export const beginAgentSessionRecovery = (input: SessionRecoveryInput): SessionRecoveryAttempt => {
  const snapshots = recoverySessionSnapshots(input.snapshots, input.agents);
  if (snapshots === undefined)
    return Object.freeze({ quiescence: Promise.resolve(), result: Promise.reject(unavailable()) });
  const tracked: Promise<unknown>[] = [];
  const deadline = Date.now() + input.recoveryTimeoutMs;
  const recoverAt = async (index: number): Promise<void> => {
    const snapshot = snapshots[index];
    if (snapshot === undefined) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw unavailable();
    const timeoutMs = Math.min(remaining, input.operationTimeoutMs);
    const inspected = await within(
      (signal) => input.inspector.inspectAndReconcileRecoveredProcess(snapshot.process, signal),
      timeoutMs,
      tracked,
    );
    if (inspected.status === 'inconclusive' || inspected.status === 'termination_unconfirmed')
      throw unavailable();
    const removalTimeoutMs = Math.min(deadline - Date.now(), input.operationTimeoutMs);
    if (removalTimeoutMs <= 0) throw unavailable();
    const removed = await within(
      (signal) =>
        input.sink.remove(
          { incarnationId: snapshot.incarnationId, sessionId: snapshot.sessionId },
          { signal },
        ),
      removalTimeoutMs,
      tracked,
    );
    if (removed.state !== 'applied') throw unavailable();
    await recoverAt(index + 1);
  };
  const result = recoverAt(0).catch((error: unknown) => {
    if (error instanceof AgentManagerError) throw error;
    throw unavailable();
  });
  const quiescence = result
    .catch(() => undefined)
    .then(() => Promise.all(tracked))
    .then(() => undefined);
  return Object.freeze({ quiescence, result });
};

export const recoverAgentSessions = (input: SessionRecoveryInput): Promise<void> =>
  beginAgentSessionRecovery(input).result;
