import { validateManagerOptions } from '../../runtime/definition/index.js';
import { AgentManagerError } from '../../runtime/errors/index.js';
import { AGENT_FAULT_MESSAGES, AGENT_RUNTIME_LIMITS } from '../../runtime/policy/index.js';
import { probeExecutable } from '../../runtime/probe/index.js';
import type { ExecutableProbePort, ProbeTarget } from '../../runtime/probe/index.js';
import { SealedAgentRegistry } from '../../runtime/registry/index.js';
import type { AgentDescriptor, AgentProbeResult, AgentRef } from '../../runtime/spec/index.js';
import { ProbeAdmission } from './probe-admission.js';

interface AgentDiscovery {
  listAgents(): readonly AgentDescriptor[];
  getAgent(agent: AgentRef): AgentDescriptor | undefined;
}

interface ProbeableAgentDiscovery extends AgentDiscovery {
  probeAgent(agent: AgentRef): Promise<AgentProbeResult>;
  probeAgents(refs: readonly AgentRef[]): Promise<readonly AgentProbeResult[]>;
}

interface BatchOperation {
  readonly target: ProbeTarget;
  readonly indexes: number[];
}

type BatchOperations =
  | Readonly<{ status: 'invalid'; index: number }>
  | Readonly<{ status: 'valid'; operations: readonly BatchOperation[] }>;

type BatchInspection =
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'limit' }>
  | Readonly<{ status: 'valid'; refs: readonly unknown[] }>;

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

const invalidLimit = (): AgentManagerError =>
  new AgentManagerError(
    Object.freeze({
      code: 'revo.agent.limit_invalid' as const,
      message: AGENT_FAULT_MESSAGES.limitInvalid,
      phase: 'probing' as const,
      retryable: false,
      details: Object.freeze({ operation: 'probeAgents', limit: AGENT_RUNTIME_LIMITS.probeBatch }),
    }),
  );

const inspectBatchRefs = (value: unknown): BatchInspection => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return Object.freeze({ status: 'invalid' });

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.enumerable ||
      lengthDescriptor.configurable
    )
      return Object.freeze({ status: 'invalid' });

    const length = lengthDescriptor.value;
    if (length > AGENT_RUNTIME_LIMITS.probeBatch) return Object.freeze({ status: 'limit' });

    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.at(-1) !== 'length')
      return Object.freeze({ status: 'invalid' });

    const refs: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (keys[index] !== key) return Object.freeze({ status: 'invalid' });

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
        return Object.freeze({ status: 'invalid' });
      refs.push(descriptor.value);
    }

    return Object.freeze({ status: 'valid', refs: Object.freeze(refs) });
  } catch {
    return Object.freeze({ status: 'invalid' });
  }
};

class InternalProbeableAgentDiscovery implements ProbeableAgentDiscovery {
  private readonly admission = new ProbeAdmission();
  private readonly probePort: ExecutableProbePort;
  private readonly registry: SealedAgentRegistry;

  constructor(registry: SealedAgentRegistry, probePort: ExecutableProbePort) {
    this.registry = registry;
    this.probePort = probePort;
    Object.freeze(this);
  }

  listAgents(): readonly AgentDescriptor[] {
    return this.registry.listAgents();
  }

  getAgent(agent: AgentRef): AgentDescriptor | undefined {
    return this.registry.getAgent(agent);
  }

  async probeAgent(agent: AgentRef): Promise<AgentProbeResult> {
    const target = this.resolveTarget(agent);
    if (target === undefined) throw unknownAgent({ operation: 'probeAgent' });

    return this.admission.runSingle(this.probeOperation(target));
  }

  async probeAgents(refs: readonly AgentRef[]): Promise<readonly AgentProbeResult[]> {
    const inspection = inspectBatchRefs(refs);
    if (inspection.status === 'invalid') throw unknownAgent({ operation: 'probeAgents' });
    if (inspection.status === 'limit') throw invalidLimit();
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
    return () => probeExecutable(target, this.probePort);
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

export const createProbeableAgentDiscovery = (
  options: unknown,
  probePort: ExecutableProbePort,
): ProbeableAgentDiscovery => {
  const validated = validateManagerOptions(options);
  const registry = SealedAgentRegistry.create(validated.definitions);

  return new InternalProbeableAgentDiscovery(registry, probePort);
};
