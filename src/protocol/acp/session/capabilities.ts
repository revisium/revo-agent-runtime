import type * as acp from '@agentclientprotocol/sdk';

import type { AgentDefinitionSessionCapabilities } from '../../../contracts/agent-definition.js';
import type { SessionProtocolCapabilities } from '../../session/model/outcome.js';

export const acpSessionClientCapabilities = (): acp.ClientCapabilities => ({
  elicitation: { form: {} },
  plan: {},
  session: { configOptions: { boolean: {} } },
});

export const negotiateAcpSessionCapabilities = (
  declared: AgentDefinitionSessionCapabilities,
  advertised: acp.AgentCapabilities | null | undefined,
  cancellation: boolean,
): SessionProtocolCapabilities =>
  Object.freeze({
    cancellation: Object.freeze({ prompt: cancellation, session: true }),
    interactions: Object.freeze({ ...declared.interactions }),
    multiTurn: true,
    resume:
      declared.resume === 'native' && advertised?.sessionCapabilities?.resume != null
        ? 'native'
        : 'none',
    updates: Object.freeze({ ...declared.updates }),
  });
