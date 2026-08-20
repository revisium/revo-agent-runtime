import type { RegisteredSecrets } from './registered-secrets.js';

export type SealedSecretRegistration =
  | Readonly<{
      status: 'registered';
      registeredSecrets: RegisteredSecrets;
    }>
  | Readonly<{
      status: 'rejected';
      reason: 'invalid_request' | 'empty_secret_value';
    }>;
