import type { AgentSessionInteractiveRequest } from '../../../../contracts/session/interaction/request.js';
import type { SessionProtocolUpdate } from '../../../../protocol/session/model/update.js';
import { ownedFrozenValue } from '../../runtime/resources/owned.js';

type ProtocolInteraction = Extract<
  SessionProtocolUpdate,
  { readonly type: 'interaction.requested' }
>['request'];

export const mapProtocolInteraction = (
  request: ProtocolInteraction,
): AgentSessionInteractiveRequest => ownedFrozenValue(request);

export const mapProtocolCapabilities = (
  capabilities: import('../../../../protocol/session/model/outcome.js').SessionProtocolCapabilities,
): import('../../../../contracts/session/capabilities/negotiated.js').AgentSessionCapabilities =>
  Object.freeze({
    interactions: Object.freeze({ ...capabilities.interactions }),
    multiTurn: true,
    resume: capabilities.resume,
    updates: Object.freeze({ ...capabilities.updates }),
  });
