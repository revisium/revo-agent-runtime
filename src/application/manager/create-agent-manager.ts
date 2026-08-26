import type { AgentManager } from '../../runtime/spec/agent-manager/index.js';
import type { AgentManagerOptions } from '../../runtime/spec/manager-options/index.js';
import { createDefaultInvocationPorts } from './create-default-invocation-ports.js';
import { createInvocationLifecycleManager } from './lifecycle-manager.js';
import { projectPublicAgentManager } from './project-public-agent-manager.js';

export const createAgentManager = (options: AgentManagerOptions): AgentManager =>
  projectPublicAgentManager(
    createInvocationLifecycleManager(options, createDefaultInvocationPorts),
  );
