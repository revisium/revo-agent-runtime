import { ProcessStartError, type ProcessSpawner } from '../../process/index.js';
import type { ConfigurationServerSpawner, ConfigurationServerStartRequest } from './inspector.js';

export class ConfigurationServerStartError extends Error {
  readonly cleanupUncertain: boolean;

  constructor(cleanupUncertain: boolean) {
    super('Configuration server could not be started.');
    this.name = 'ConfigurationServerStartError';
    this.cleanupUncertain = cleanupUncertain;
  }
}

export const createConfigurationServerSpawner = (
  processes: ProcessSpawner,
): ConfigurationServerSpawner =>
  Object.freeze({
    start: async (request: ConfigurationServerStartRequest, signal: AbortSignal) => {
      try {
        return await processes.start(request, signal);
      } catch (error) {
        if (error instanceof ProcessStartError)
          throw new ConfigurationServerStartError(error.cleanup === 'uncertain');
        throw error;
      }
    },
  });
