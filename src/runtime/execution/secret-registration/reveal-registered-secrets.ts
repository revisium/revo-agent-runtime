import { RegisteredSecrets } from './registered-secrets.js';

// Sole authorized extraction path for raw secret values from an authentic capability.
export const revealRegisteredSecrets = (capability: unknown): readonly string[] | undefined =>
  RegisteredSecrets.reveal(capability);
