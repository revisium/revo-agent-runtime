import { AgentManagerError, limitInvalidError } from '../../runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES, AGENT_RUNTIME_LIMITS } from '../../runtime/policy/index.js';
import { probeExecutable } from '../../runtime/probe/index.js';
import type { ExecutableProbePort, ProbeTarget } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type { AgentProbeResult, AgentRef } from '../../runtime/spec/index.js';
import { inspectBatchRefs } from './inspect-batch-refs.js';
import { managerClosedError } from './manager-closed-error.js';
import { ProbeAdmission } from './probe-admission.js';

interface BatchOperation {
  readonly target: ProbeTarget;
  readonly indexes: number[];
}

type BatchOperations =
  | Readonly<{ status: 'invalid'; index: number }>
  | Readonly<{ status: 'valid'; operations: readonly BatchOperation[] }>;

const unknownAgent = (details: Readonly<Record<string, string | number>>): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.agent_unknown' as const,
      message: AGENT_FAULT_MESSAGES.agentUnknown,
      phase: 'probing' as const,
      retryable: false,
      details: Object.freeze({ ...details }),
    }),
  );

export class ProbeCoordinator {
  private readonly admission = new ProbeAdmission();
  private readonly probePort: ExecutableProbePort;
  private readonly registry: SealedAgentRegistry;
  private readonly isClosing: () => boolean;

  constructor(
    registry: SealedAgentRegistry,
    probePort: ExecutableProbePort,
    isClosing: () => boolean,
  ) {
    this.registry = registry;
    this.probePort = probePort;
    this.isClosing = isClosing;
    Object.freeze(this);
  }

  async probeAgent(agent: AgentRef): Promise<AgentProbeResult> {
    const target = this.resolveTarget(agent);
    if (target === undefined) throw unknownAgent({ operation: 'probeAgent' });

    return this.admission.runSingle(this.probeOperation(target));
  }

  async probeAgents(refs: readonly AgentRef[]): Promise<readonly AgentProbeResult[]> {
    const inspection = inspectBatchRefs(refs, AGENT_RUNTIME_LIMITS.probeBatch);
    if (inspection.status === 'invalid') throw unknownAgent({ operation: 'probeAgents' });
    if (inspection.status === 'limit')
      throw limitInvalidError(
        'probing',
        'probeAgents',
        AGENT_RUNTIME_LIMITS.probeBatch,
        AGENT_FAULT_MESSAGES.limitInvalid,
      );
    if (inspection.refs.length === 0) return Object.freeze([]);

    const batchOperations = this.batchOperations(inspection.refs);
    if (batchOperations.status === 'invalid')
      throw unknownAgent({ operation: 'probeAgents', index: batchOperations.index });

    const results = await this.admission.runBatch(
      batchOperations.operations.map(({ target }) => this.probeOperation(target)),
    );
    return this.fanOutBatchResults(batchOperations.operations, results, inspection.refs.length);
  }

  private batchOperations(refs: readonly unknown[]): BatchOperations {
    const byId = new Map<string, Map<string, BatchOperation>>();
    const operations: BatchOperation[] = [];

    for (const [index, ref] of refs.entries()) {
      const target = this.resolveTarget(ref);
      if (target === undefined) return Object.freeze({ status: 'invalid', index });

      const versions = byId.get(target.definition.id);
      const existing = versions?.get(target.definition.version);
      if (existing !== undefined) {
        existing.indexes.push(index);
        continue;
      }

      const operation: BatchOperation = { target, indexes: [index] };
      if (versions === undefined)
        byId.set(target.definition.id, new Map([[target.definition.version, operation]]));
      else versions.set(target.definition.version, operation);
      operations.push(operation);
    }

    return Object.freeze({ status: 'valid', operations: Object.freeze(operations) });
  }

  private fanOutBatchResults(
    operations: readonly BatchOperation[],
    results: readonly AgentProbeResult[],
    length: number,
  ): readonly AgentProbeResult[] {
    const output = new Array<AgentProbeResult>(length);
    for (const [index, result] of results.entries()) {
      const operation = operations[index];
      if (operation === undefined) continue;
      for (const outputIndex of operation.indexes) output[outputIndex] = result;
    }
    return Object.freeze(output);
  }

  private probeOperation(target: ProbeTarget): () => Promise<AgentProbeResult> {
    return () =>
      this.isClosing()
        ? Promise.reject(managerClosedError())
        : probeExecutable(target, this.probePort);
  }

  private resolveTarget(ref: unknown): ProbeTarget | undefined {
    try {
      const validated = this.registry.getDefinition(ref);
      if (validated === undefined) return undefined;
      return Object.freeze({
        definition: validated.definition,
        definitionDigest: validated.definitionDigest,
      });
    } catch {
      return undefined;
    }
  }
}
