import type { AgentDefinitionInput } from '../../../src/index.js';
import { fakeAcpAgentDefinition } from '../../support/fake-acp/definition.js';

export const strictResultSchema = Object.freeze({
  additionalProperties: false,
  properties: Object.freeze({ ok: Object.freeze({ const: true, type: 'boolean' }) }),
  required: Object.freeze(['ok']),
  type: 'object',
});

export const fakeAgentDefinition = (mode: string): AgentDefinitionInput =>
  fakeAcpAgentDefinition({ displayName: 'Fake ACP', id: 'fake-acp', mode });
