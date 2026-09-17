import type { InstructionsDeliveryRequest } from '../../execution/instructions/delivery.js';
import type { ProviderHost, ProviderInstructionsDelivery } from '../instructions-delivery.js';

/** OpenCode releases whose config merge and instruction-file loading were source-verified. */
const nativeReportedVersions: readonly string[] = Object.freeze(['1.18.23']);
const configurationVariable = 'OPENCODE_CONFIG_CONTENT';
/** No leading dot and no glob metacharacters: OpenCode globs the basename without `dot`. */
export const openCodeInstructionsFileName = 'revo-opencode-instructions.md';
const encoder = new TextEncoder();

const bindsConfigurationVariable = (names: readonly string[]): boolean =>
  names.some((name) => name.toUpperCase() === configurationVariable);

/** OpenCode substitutes `{env:…}`/`{file:…}` inside config text, so braces cannot be quoted. */
const containsSubstitution = (path: string): boolean => path.includes('{') || path.includes('}');

const eligible = (request: InstructionsDeliveryRequest, host: ProviderHost): boolean =>
  nativeReportedVersions.includes(request.reportedVersion) &&
  host.platform !== 'win32' &&
  !bindsConfigurationVariable(request.environmentNames) &&
  !containsSubstitution(request.outputDirectory);

/** The claimed output directory is a normalized absolute POSIX path, so one separator joins it. */
const instructionsFilePath = (outputDirectory: string): string =>
  `${outputDirectory}/${openCodeInstructionsFileName}`;

export const openCodeInstructionsDelivery: ProviderInstructionsDelivery = (request, host) => {
  if (!eligible(request, host)) return undefined;
  const path = instructionsFilePath(request.outputDirectory);
  return {
    artifact: { bytes: encoder.encode(request.instructions), path },
    channel: 'opencode:config.instructions-file',
    environment: { [configurationVariable]: JSON.stringify({ instructions: [path] }) },
    mode: 'native_append',
  };
};
