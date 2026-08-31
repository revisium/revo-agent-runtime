import type * as acp from '@agentclientprotocol/sdk';

import type { AgentConfigurationSelectionValue } from '../../contracts/configuration.js';

export interface AcpConfigurationRequester {
  request(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown>;
  setOption(params: acp.SetSessionConfigOptionRequest): Promise<readonly acp.SessionConfigOption[]>;
}

export interface AcpConfigurationCompatibility {
  readonly decorate?: (
    options: readonly acp.SessionConfigOption[],
  ) => readonly acp.SessionConfigOption[];
  readonly legacyOptions?: (
    sessionResponse: Readonly<Record<string, unknown>>,
  ) => readonly acp.SessionConfigOption[];
  readonly applyLegacy?: (
    requester: AcpConfigurationRequester,
    sessionId: string,
    options: readonly acp.SessionConfigOption[],
    configId: string,
    value: AgentConfigurationSelectionValue,
  ) => Promise<readonly acp.SessionConfigOption[]>;
}

export type AcpConfigurationCompatibilityResolver = (
  definitionId: string,
) => AcpConfigurationCompatibility | undefined;
