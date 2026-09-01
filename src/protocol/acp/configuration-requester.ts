import * as acp from '@agentclientprotocol/sdk';

import type { AcpConfigurationRequester } from './compatibility.js';

export const acpConfigurationRequester = (
  context: Pick<acp.ClientContext, 'request'>,
): AcpConfigurationRequester =>
  Object.freeze({
    request: (method: string, params: Readonly<Record<string, unknown>>) =>
      context.request(method, params),
    setOption: async (params: acp.SetSessionConfigOptionRequest) =>
      (await context.request(acp.methods.agent.session.setConfigOption, params)).configOptions,
  });
