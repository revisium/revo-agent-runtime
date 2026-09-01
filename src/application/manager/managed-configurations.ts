import type {
  AgentConfigurationCatalog,
  InspectAgentConfiguration,
} from '../../contracts/configuration.js';
import { AgentManagerError, type AgentStartContext } from '../../contracts/manager.js';
import type { AgentConfigurationInspector } from '../../execution/configuration/inspector.js';
import type { ExecutablePreflight } from '../../execution/probe/executable-preflight.js';
import { snapshotConfigurationInspection } from '../configuration/request.js';
import {
  cancellationFailure,
  executablePreflightError,
  fault,
  managerError,
  timeoutFailure,
} from '../faults/agent-faults.js';
import { captureStartEnvironment } from '../invocation/preflight.js';
import type { AgentCatalog } from './agent-catalog.js';
import type { EffectiveLimits } from './limits.js';
import type { PendingOperations } from './pending-operations.js';

/** Owns explicit short-lived session configuration inspection operations. */
export class ManagedConfigurations {
  constructor(
    private readonly catalog: AgentCatalog,
    private readonly inspector: AgentConfigurationInspector,
    private readonly executablePreflight: ExecutablePreflight,
    private readonly limits: EffectiveLimits,
    private readonly pendingOperations: PendingOperations,
    private readonly isClosed: () => boolean,
  ) {}

  async inspect(
    value: InspectAgentConfiguration,
    context?: AgentStartContext,
  ): Promise<AgentConfigurationCatalog> {
    let request: InspectAgentConfiguration;
    try {
      request = snapshotConfigurationInspection(value);
    } catch {
      throw new AgentManagerError(
        fault('revo.agent.definition_invalid', 'Configuration request is invalid.', 'preflight'),
      );
    }
    const resolved = this.catalog.resolve(request.agent);
    if (resolved === undefined)
      throw managerError('revo.agent.agent_unknown', 'Agent reference is unknown.');
    const managerCancellation = new AbortController();
    const signal = AbortSignal.any([
      managerCancellation.signal,
      ...(context?.signal === undefined ? [] : [context.signal]),
    ]);
    const pending = this.pendingOperations.track(() => managerCancellation.abort());
    try {
      const environment = captureStartEnvironment(context);
      const preflight = await this.executablePreflight.probe(
        resolved.definition.definition,
        signal,
      );
      if (preflight.status === 'aborted') throw new AgentManagerError(cancellationFailure());
      if (preflight.status === 'rejected') throw executablePreflightError(preflight.reason);
      const outcome = await this.inspector.inspect({
        definition: resolved.definition.definition,
        environment: environment.values,
        idleTimeoutMs: this.limits.idleTimeoutMs,
        launch: preflight.launch,
        maxOutputBytes: this.limits.maxRawResponseBytes,
        redactionSecrets: environment.secrets,
        signal,
        wallClockTimeoutMs: this.limits.wallClockTimeoutMs,
        workspace: request.workspace.directory,
      });
      if (outcome.status === 'cancelled') throw new AgentManagerError(cancellationFailure());
      if (outcome.status === 'timed_out') throw new AgentManagerError(timeoutFailure());
      if (outcome.status === 'cleanup_uncertain')
        throw new AgentManagerError(
          fault(
            'revo.agent.process_cleanup_failed',
            'Agent process cleanup could not be confirmed.',
            'execution',
          ),
        );
      if (outcome.status === 'failed')
        throw new AgentManagerError(
          fault(
            'revo.agent.protocol_failed',
            'Agent configuration inspection failed.',
            'execution',
          ),
        );
      if (this.isClosed())
        throw managerError('revo.agent.manager_closed', 'Agent manager is closed.');
      return Object.freeze({
        agent: resolved.descriptor.agent,
        catalogRevision: outcome.catalog.catalogRevision,
        definitionDigest: resolved.descriptor.definitionDigest,
        launch: outcome.launch,
        ...(outcome.catalog.model === undefined ? {} : { model: outcome.catalog.model }),
        options: outcome.catalog.options,
        schemaVersion: 'agent-configuration-catalog/v1',
      });
    } finally {
      pending.finish();
    }
  }
}
