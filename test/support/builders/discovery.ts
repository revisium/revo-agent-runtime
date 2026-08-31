import type { AgentDiscoveryDiagnostic } from '../../../src/index.js';
import { agentDefinition } from './agent-definition.js';

export const detectedDefinition = (id: string, version = '1.0.0') =>
  agentDefinition({ id, version });

export const detectorDiagnostic = (code: string): AgentDiscoveryDiagnostic => ({
  code,
  message: 'A bounded detector diagnostic.',
  severity: 'info',
});
