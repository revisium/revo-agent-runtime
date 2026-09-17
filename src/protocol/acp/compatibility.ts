import type * as acp from '@agentclientprotocol/sdk';

import type { AgentConfigurationSelectionValue } from '../../contracts/configuration.js';
import type { AgentMcpServer } from '../../contracts/context.js';

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

/** Provider protocol quirks; configuration clients depend only on the narrower base. */
export interface AcpProviderCompatibility extends AcpConfigurationCompatibility {
  /** Provider-owned interpretation of explicit caller grants; omission keeps host policy. */
  readonly approveMcpPermission?: (
    request: acp.RequestPermissionRequest,
    permissions: Readonly<Record<string, unknown>>,
    servers: readonly AgentMcpServer[],
  ) => string | undefined;
  /** Execute task and result formatting as separate turns in the same session. */
  readonly finalResultTurn?: boolean;
}

export type AcpProviderCompatibilityResolver = (
  definitionId: string,
) => AcpProviderCompatibility | undefined;
