import type { ActiveInvocationSnapshot } from '../../../src/contracts/manager.js';
import { createSealedAgentRegistry } from '../../../src/definition/index.js';
import type {
  RecoveredProcessInspector,
  RecoveredProcessReconciliation,
} from '../../../src/execution/process/port.js';
import { agentDefinition } from '../builders/agent-definition.js';
import { processIdentity } from '../builders/process-identity.js';

export const recoverySnapshot = (
  invocationId: string,
  overrides: Partial<ActiveInvocationSnapshot> = {},
): ActiveInvocationSnapshot => {
  const definition = createSealedAgentRegistry([agentDefinition()]).list()[0]!;
  return {
    invocationId,
    pin: {
      agentId: definition.definition.id,
      agentVersion: definition.definition.version,
      definitionDigest: definition.digest,
    },
    process: processIdentity(),
    state: 'running',
    ...overrides,
  };
};

interface HeldRecoveryInspection {
  settle(status: RecoveredProcessReconciliation['status']): void;
}

export interface RecoveryStory {
  readonly inspector: RecoveredProcessInspector;
  holdNext(): HeldRecoveryInspection;
  observe(status: RecoveredProcessReconciliation['status']): void;
  signals(): readonly AbortSignal[];
  waitUntilInspected(count: number): Promise<void>;
}

export const recoveryStory = (): RecoveryStory => {
  const outcomes: Array<Promise<RecoveredProcessReconciliation>> = [];
  const signals: AbortSignal[] = [];
  const waiters: Array<() => void> = [];
  const waitUntilInspected = async (count: number): Promise<void> => {
    if (signals.length >= count) return;
    await new Promise<void>((resolve) => waiters.push(resolve));
    return waitUntilInspected(count);
  };
  return {
    inspector: {
      inspectAndReconcileRecoveredProcess: (_identity, signal) => {
        signals.push(signal);
        waiters.splice(0).forEach((resolve) => resolve());
        return outcomes.shift() ?? Promise.resolve({ status: 'absent' });
      },
    },
    holdNext: () => {
      const held = Promise.withResolvers<RecoveredProcessReconciliation>();
      outcomes.push(held.promise);
      return { settle: (status) => held.resolve({ status }) };
    },
    observe: (status) => outcomes.push(Promise.resolve({ status })),
    signals: () => [...signals],
    waitUntilInspected,
  };
};
