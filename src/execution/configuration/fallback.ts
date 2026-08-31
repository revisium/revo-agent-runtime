import type { NormalizedAcpConfiguration } from '../../configuration/catalog.js';

export interface ConfigurationCatalogFallback {
  readonly args: readonly string[];
  parse(stdout: Uint8Array): NormalizedAcpConfiguration;
}

export type ConfigurationCatalogFallbackResolver = (
  definitionId: string,
) => ConfigurationCatalogFallback | undefined;
