import type { RedactionChannel } from '../redaction/index.js';
import { InvocationBoundCarrier } from './invocation-bound-carrier.js';
import type { OutputPreparationFileAttestation } from './output-preparation-file-attestation.js';

type PreparedInvocationResourceFrontEnds = Readonly<{
  stdout: RedactionChannel;
  stderr: RedactionChannel;
  rawResponse: RedactionChannel;
}>;

type PreparedInvocationResourcesInput = Readonly<{
  invocationId: string;
  outputDirectory: string;
  invocationToken: object;
  attestations: readonly OutputPreparationFileAttestation[];
  frontEnds: PreparedInvocationResourceFrontEnds;
}>;

export class PreparedInvocationResources extends InvocationBoundCarrier {
  #attestations: readonly OutputPreparationFileAttestation[] | undefined;
  #frontEnds: PreparedInvocationResourceFrontEnds | undefined;

  private constructor(input: PreparedInvocationResourcesInput) {
    super(input);
    this.#attestations = input.attestations;
    this.#frontEnds = input.frontEnds;
  }

  static create(input: PreparedInvocationResourcesInput): PreparedInvocationResources {
    return new PreparedInvocationResources(input);
  }

  static take(resources: unknown):
    | Readonly<{
        attestations: readonly OutputPreparationFileAttestation[];
        frontEnds: PreparedInvocationResourceFrontEnds;
      }>
    | undefined {
    if (!PreparedInvocationResources.isAuthentic(resources)) return undefined;
    const attestations = resources.#attestations;
    const frontEnds = resources.#frontEnds;
    resources.#attestations = undefined;
    resources.#frontEnds = undefined;
    if (attestations === undefined || frontEnds === undefined) return undefined;
    return Object.freeze({ attestations, frontEnds });
  }

  static override isBoundToToken(resources: unknown, token: object): boolean {
    return (
      PreparedInvocationResources.isAuthentic(resources) &&
      InvocationBoundCarrier.isBoundToToken(resources, token)
    );
  }

  static isAuthentic(resources: unknown): resources is PreparedInvocationResources {
    return typeof resources === 'object' && resources !== null && #attestations in resources;
  }
}
