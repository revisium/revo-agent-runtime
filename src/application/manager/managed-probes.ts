import type { AgentRef } from '../../contracts/agent-definition.js';
import type { AgentProbeResult } from '../../contracts/manager.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import {
  internalProbeError,
  managerError,
  unknownAgentProbeError,
} from '../faults/agent-faults.js';
import type { AgentCatalog } from './agent-catalog.js';
import type { PendingOperations } from './pending-operations.js';
import { runAgentProbe } from './probe-agent.js';

/** Runs public probes while sharing manager shutdown cancellation and quiescence. */
export class ManagedAgentProbes {
  constructor(
    private readonly catalog: AgentCatalog,
    private readonly executablePreflight: ExecutablePreflight,
    private readonly pendingOperations: PendingOperations,
    private readonly isClosed: () => boolean,
  ) {}

  async probe(agent: AgentRef): Promise<AgentProbeResult> {
    const resolved = this.catalog.resolve(agent);
    if (resolved === undefined) throw unknownAgentProbeError();

    const cancellation = new AbortController();
    const pending = this.pendingOperations.track(() => cancellation.abort());
    try {
      const attempt = await runAgentProbe({
        definition: resolved.definition,
        descriptor: resolved.descriptor,
        executablePreflight: this.executablePreflight,
        signal: cancellation.signal,
      });
      if (this.isClosed())
        throw managerError('revo.agent.manager_closed', 'Agent manager is closed.');
      if (attempt.status === 'aborted') throw internalProbeError();
      if (attempt.status === 'failed') throw attempt.error;
      return attempt.result;
    } finally {
      pending.finish();
    }
  }
}
