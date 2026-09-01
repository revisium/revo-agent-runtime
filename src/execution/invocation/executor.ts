import type { ProtocolDriver } from '../../protocol/driver.js';
import type { ProcessSpawner } from '../process/port.js';
import type { InvocationExecutionRequest, InvocationExecutor } from './contracts.js';
import { startInvocationLifecycle } from './lifecycle.js';

export type {
  ExecutionAdmission,
  ExecutionDrainage,
  ExecutionEvidence,
  InvocationExecution,
  InvocationExecutionRequest,
  InvocationExecutor,
} from './contracts.js';
export type { ExecutionOutcome } from './terminal.js';

export const createInvocationExecutor = (
  processes: ProcessSpawner,
  protocol: ProtocolDriver,
): InvocationExecutor =>
  Object.freeze({
    start: (request: InvocationExecutionRequest) =>
      startInvocationLifecycle(processes, protocol, request),
  });
