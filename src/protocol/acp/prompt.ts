import type { ProtocolSessionRequest } from '../driver.js';

const invocationContract = (
  request: Pick<ProtocolSessionRequest, 'parameters' | 'permissions' | 'resultSchema'>,
): string =>
  JSON.stringify({
    parameters: request.parameters,
    permissions: request.permissions,
    resultSchema: request.resultSchema,
  });

/** Delivers the caller prompt and Revo invocation contract as one ordered ACP text prompt. */
export const acpPrompt = (
  request: Pick<ProtocolSessionRequest, 'parameters' | 'permissions' | 'prompt' | 'resultSchema'>,
) => [
  Object.freeze({
    text:
      `${request.prompt}\n\nRevo invocation contract (JSON):\n${invocationContract(request)}\n` +
      'Honor the parameters and permission constraints. Return exactly one JSON object matching resultSchema, without markdown or surrounding text.',
    type: 'text' as const,
  }),
];
