import type { BundledAcpProviderPolicy } from '../bundled-bridge-detector.js';

/** Claude owns its exact bridge package and prefix-free override version output. */
export const claudeProviderPolicy: BundledAcpProviderPolicy = Object.freeze({
  bridge: Object.freeze({
    binName: 'claude-agent-acp',
    bridgeName: '@agentclientprotocol/claude-agent-acp',
    bridgeVersion: '0.70.0',
    vendorDependencyRange: '0.3.232',
    vendorName: '@anthropic-ai/claude-agent-sdk',
    vendorVersion: '0.3.232',
  }),
  detectorId: 'claude',
  displayName: 'Claude ACP',
  id: 'claude-acp',
  version: '0.70.0',
});
