export type SealedSecretRegistration =
  | Readonly<{
      status: 'registered';
      secretValues: readonly string[];
    }>
  | Readonly<{
      status: 'rejected';
      reason: 'invalid_request' | 'empty_secret_value';
    }>;
