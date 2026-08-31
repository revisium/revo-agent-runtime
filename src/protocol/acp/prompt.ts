import type { ProtocolSessionRequest } from '../driver.js';

const invocationContract = (
  request: Pick<ProtocolSessionRequest, 'parameters' | 'permissions' | 'resultSchema'>,
): string =>
  JSON.stringify({
    parameters: request.parameters,
    permissions: request.permissions,
    resultSchema: request.resultSchema,
  });

/** Keeps the caller prompt distinct while delivering Revo's complete invocation contract. */
export const acpPrompt = (
  request: Pick<ProtocolSessionRequest, 'parameters' | 'permissions' | 'prompt' | 'resultSchema'>,
) => [
  Object.freeze({ text: request.prompt, type: 'text' as const }),
  Object.freeze({
    text:
      `Revo invocation contract (JSON):\n${invocationContract(request)}\n` +
      'Honor the parameters and permission constraints. Return exactly one JSON object matching resultSchema, without markdown or surrounding text.',
    type: 'text' as const,
  }),
];
