import type { BundledAcpProviderPolicy } from '../bundled-bridge-detector.js';

/** Codex owns the exact bridge package and override version output convention. */
export const codexProviderPolicy: BundledAcpProviderPolicy = Object.freeze({
  bridge: Object.freeze({
    binName: 'codex-acp',
    bridgeName: '@agentclientprotocol/codex-acp',
    bridgeVersion: '1.7.0',
    vendorDependencyRange: '^0.148.0',
    vendorName: '@openai/codex',
    vendorVersion: '0.148.0',
  }),
  detectorId: 'codex',
  displayName: 'Codex ACP',
  id: 'codex-acp',
  systemOverrideVersionProbePrefix: '@agentclientprotocol/codex-acp ',
  version: '1.7.0',
});
