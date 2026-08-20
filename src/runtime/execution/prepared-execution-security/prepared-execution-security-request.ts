import type { RegisteredSecrets } from '../secret-registration/index.js';

export interface PreparedExecutionSecurityRequest {
  readonly invocationId: string;
  readonly childEnvironment: Readonly<Record<string, string>>;
  readonly registeredSecrets: RegisteredSecrets;
}
