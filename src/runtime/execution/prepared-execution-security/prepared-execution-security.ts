import type { RegisteredSecrets } from '../secret-registration/index.js';

export class PreparedExecutionSecurity {
  // Self-minted, not the shared per-invocation token network (spec line 611/326) -- deferred until a preclaim token producer exists; cross-invocation defense is invocationId equality in consumeRedactionMaterial after both brands authenticate.
  readonly #token: object;
  readonly invocationId: string;
  #environment: Readonly<Record<string, string>> | undefined;
  #redaction: RegisteredSecrets | undefined;

  private constructor(
    input: Readonly<{
      invocationId: string;
      environment: Readonly<Record<string, string>>;
      redaction: RegisteredSecrets;
    }>,
  ) {
    this.#token = Object.freeze({});
    this.invocationId = input.invocationId;
    this.#environment = input.environment;
    this.#redaction = input.redaction;
    Object.freeze(this);
  }

  static create(
    input: Readonly<{
      invocationId: string;
      environment: Readonly<Record<string, string>>;
      redaction: RegisteredSecrets;
    }>,
  ): PreparedExecutionSecurity {
    return new PreparedExecutionSecurity(input);
  }

  static takeEnvironment(capability: unknown): Readonly<Record<string, string>> | undefined {
    if (!PreparedExecutionSecurity.isAuthentic(capability)) return undefined;
    const environment = capability.#environment;
    capability.#environment = undefined;
    return environment;
  }

  static takeRedaction(
    capability: unknown,
  ): Readonly<{ invocationId: string; redaction: RegisteredSecrets }> | undefined {
    if (!PreparedExecutionSecurity.isAuthentic(capability)) return undefined;
    const redaction = capability.#redaction;
    if (redaction === undefined) return undefined;
    capability.#redaction = undefined;
    return Object.freeze({ invocationId: capability.invocationId, redaction });
  }

  static isAuthentic(capability: unknown): capability is PreparedExecutionSecurity {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      #token in capability &&
      capability.#token !== undefined
    );
  }
}
