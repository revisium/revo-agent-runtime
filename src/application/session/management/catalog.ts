import type { AgentRef } from '../../../contracts/agent-definition.js';
import type { AgentDescriptor, AgentExecutionPin } from '../../../contracts/manager/core.js';
import type { AgentSessionAgentDescriptor } from '../../../contracts/session.js';
import { sessionManagerError } from './errors.js';

const supportsSessions = (descriptor: AgentDescriptor): descriptor is AgentSessionAgentDescriptor =>
  descriptor.capabilities.session !== undefined;

export class SessionAgentCatalog {
  readonly #agents: readonly AgentDescriptor[];
  readonly #sessionAgents: readonly AgentSessionAgentDescriptor[];

  constructor(agents: readonly AgentDescriptor[]) {
    this.#agents = Object.freeze([...agents]);
    this.#sessionAgents = Object.freeze(this.#agents.filter(supportsSessions));
  }

  list(): readonly AgentSessionAgentDescriptor[] {
    return this.#sessionAgents;
  }

  require(agent: AgentRef): AgentSessionAgentDescriptor {
    const descriptor = this.#agents.find(
      (candidate) => candidate.agent.id === agent.id && candidate.agent.version === agent.version,
    );
    if (descriptor === undefined)
      throw sessionManagerError('revo.agent.agent_unknown', 'The requested agent is unknown.');
    if (!supportsSessions(descriptor))
      throw sessionManagerError(
        'revo.agent.session_unsupported',
        'The requested agent does not support sessions.',
      );
    return descriptor;
  }

  requirePin(pin: AgentExecutionPin): AgentSessionAgentDescriptor {
    const descriptor = this.require({ id: pin.agentId, version: pin.agentVersion });
    if (descriptor.definitionDigest !== pin.definitionDigest)
      throw sessionManagerError(
        'revo.agent.continuation_pin_mismatch',
        'The resume token definition pin does not match the agent catalog.',
      );
    return descriptor;
  }
}
