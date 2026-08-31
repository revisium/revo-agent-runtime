import type { AgentDetectorResult } from '../contracts/discovery.js';

export const unavailableModels: AgentDetectorResult['diagnostics'][number] = Object.freeze({
  code: 'model_enumeration_unavailable',
  message: 'Model enumeration requires credentials and was not attempted.',
  severity: 'info',
});

export const systemOverrideUnavailable = (
  provider: string,
): AgentDetectorResult['diagnostics'][number] =>
  Object.freeze({
    code: 'system_override_unavailable',
    message: `Selected ${provider} ACP system override is unavailable.`,
    severity: 'error',
  });

export const bundledBridgeUnavailable = (): AgentDetectorResult['diagnostics'][number] =>
  Object.freeze({
    code: 'bundled_bridge_unavailable',
    message: 'The exact bundled ACP bridge is unavailable.',
    severity: 'error',
  });
