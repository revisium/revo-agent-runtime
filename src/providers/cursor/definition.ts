import type { AdjacentNodePackagePolicy } from '../../discovery/platform.js';
import { acpDefinition } from '../acp-definition.js';

const cursorVersionProbeTimeoutMs = 5_000;

export const cursorPackagePolicy: AdjacentNodePackagePolicy = Object.freeze({
  command: 'agent',
  entrypointName: 'index.js',
  launcherName: 'cursor-agent',
});

export const cursorAcpDefinition = (node: string, entrypoint: string) =>
  acpDefinition({
    args: [entrypoint, 'acp'],
    command: node,
    displayName: 'Cursor ACP',
    id: 'cursor-acp',
    version: '1.0.0',
    versionProbeArgs: [entrypoint, '--version'],
    versionProbeTimeoutMs: cursorVersionProbeTimeoutMs,
  });
