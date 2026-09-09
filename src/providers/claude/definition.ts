import type { BundledAcpProviderPolicy } from '../bundled-bridge-detector.js';

/** Claude owns its exact bridge package and prefix-free override version output. */
export const claudeProviderPolicy: BundledAcpProviderPolicy = Object.freeze({
  bridge: Object.freeze({
    binName: 'claude-agent-acp',
    bridgeName: '@agentclientprotocol/claude-agent-acp',
  }),
  cli: Object.freeze({ command: 'claude', packageName: '@anthropic-ai/claude-code' }),
  cliEnvironmentVariable: 'CLAUDE_CODE_EXECUTABLE',
  detectorId: 'claude',
  displayName: 'Claude ACP',
  id: 'claude-acp',
  version: '0.70.0',
});
