import type { ProtocolSessionRequest } from '../driver.js';
import { prefixInstructions } from './instructions.js';

const invocationContract = (
  request: Pick<ProtocolSessionRequest, 'parameters' | 'permissions' | 'resultSchema'>,
): string =>
  JSON.stringify({
    parameters: request.parameters,
    permissions: request.permissions,
    resultSchema: request.resultSchema,
  });

const callerPrompt = (request: Pick<ProtocolSessionRequest, 'instructions' | 'prompt'>): string =>
  request.instructions?.delivery.mode === 'prompt_prefix'
    ? prefixInstructions(request.prompt, request.instructions.text)
    : request.prompt;

/** Delivers the caller prompt and Revo invocation contract as one ordered ACP text prompt. */
export const acpPrompt = (
  request: Pick<
    ProtocolSessionRequest,
    'instructions' | 'parameters' | 'permissions' | 'prompt' | 'resultSchema'
  >,
) => [
  Object.freeze({
    text:
      `${callerPrompt(request)}\n\nRevo invocation contract (JSON):\n${invocationContract(request)}\n` +
      'Honor the parameters and permission constraints. Return exactly one JSON object matching resultSchema, without markdown or surrounding text.',
    type: 'text' as const,
  }),
];
