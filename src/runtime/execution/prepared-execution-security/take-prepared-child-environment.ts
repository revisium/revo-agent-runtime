import { PreparedExecutionSecurity } from './prepared-execution-security.js';

export const takePreparedChildEnvironment = (
  capability: unknown,
): Readonly<Record<string, string>> | undefined =>
  PreparedExecutionSecurity.takeEnvironment(capability);
