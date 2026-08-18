export interface SecretRegistrationRequest {
  readonly configuredSecrets: readonly string[];
  readonly invocationSecrets: readonly string[];
}
