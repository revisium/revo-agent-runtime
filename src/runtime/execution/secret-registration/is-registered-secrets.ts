import { RegisteredSecrets } from './registered-secrets.js';

export const isRegisteredSecrets = (capability: unknown): capability is RegisteredSecrets =>
  RegisteredSecrets.isAuthentic(capability);
