import type {
  InvocationExecution,
  InvocationExecutor,
} from '../../execution/invocation/executor.js';
import { resolvedMcpSecretValues } from '../../execution/mcp/servers.js';
import { preacceptanceError } from '../faults/agent-faults.js';
import type { InvocationEvents } from './invocation-events.js';
import type { PreparedInvocationStart } from './prepare-invocation-start.js';

/** Builds the one executor request from an admitted, package-owned start snapshot. */
export const startInvocationExecution = async (
  executor: InvocationExecutor,
  start: PreparedInvocationStart,
  events: InvocationEvents,
  managerRedactionSecrets: readonly string[],
): Promise<InvocationExecution> => {
  const { definition, limits, request } = start.prepared;
  try {
    return executor.start({
      definition: definition.definition,
      ...(request.configuration === undefined ? {} : { configuration: request.configuration }),
      ...(start.instructions === undefined ? {} : { instructions: start.instructions }),
      ...(start.mcpServers === undefined ? {} : { mcpServers: start.mcpServers }),
      idleTimeoutMs: limits.idleTimeoutMs,
      launch: start.admission.launch,
      environment: start.environment.values,
      maxRawResponseBytes: limits.maxRawResponseBytes,
      maxStderrBytes: limits.maxStderrBytes,
      maxStdoutBytes: limits.maxStdoutBytes,
      onCancelling: events.onCancelling,
      onStarted: events.onStarted,
      parameters: start.inputs.parameters,
      permissions: start.inputs.permissions,
      prompt: request.prompt,
      resultSchema: request.result.schema,
      redactionSecrets: [
        ...managerRedactionSecrets,
        ...start.environment.secrets,
        ...resolvedMcpSecretValues(start.mcpServers),
      ],
      wallClockTimeoutMs: limits.wallClockTimeoutMs,
      workspace: request.workspace.directory,
    });
  } catch {
    await start.instructions?.artifact?.dispose();
    throw preacceptanceError({ status: 'failed' }, 'confirmed');
  }
};
