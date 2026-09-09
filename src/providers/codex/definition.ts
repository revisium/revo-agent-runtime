import type { BundledAcpProviderPolicy } from '../bundled-bridge-detector.js';

/** Codex owns the exact bridge package and override version output convention. */
export const codexProviderPolicy: BundledAcpProviderPolicy = Object.freeze({
  bridge: Object.freeze({
    binName: 'codex-acp',
    bridgeName: '@agentclientprotocol/codex-acp',
  }),
  cli: Object.freeze({
    command: 'codex',
    packageName: '@openai/codex',
    nativePackagePrefix: '@openai/codex',
    nativeTargets: Object.freeze({
      'linux-x64': 'x86_64-unknown-linux-musl',
      'linux-arm64': 'aarch64-unknown-linux-musl',
      'darwin-x64': 'x86_64-apple-darwin',
      'darwin-arm64': 'aarch64-apple-darwin',
      'win32-x64': 'x86_64-pc-windows-msvc',
      'win32-arm64': 'aarch64-pc-windows-msvc',
    }),
  }),
  cliEnvironmentVariable: 'CODEX_PATH',
  cliVersionPrefix: 'codex-cli ',
  detectorId: 'codex',
  displayName: 'Codex ACP',
  id: 'codex-acp',
  version: '1.7.0',
});
