import type { ExecutionBinding } from '../execution-binding.js';
import type { OutputPreparationFileSlot } from '../output-preparation-attempt/output-preparation-file-slot.js';

export class PreparedInvocation {
  readonly #token: object;
  readonly invocationId: string;
  readonly pin: Readonly<{ agentId: string; agentVersion: string; definitionDigest: string }>;
  readonly workspaceDirectory: string;
  readonly outputDirectory: string;
  readonly reportedVersion: string;
  readonly binding: ExecutionBinding;
  // The binding above is unauthenticated caller-supplied data (shape + plan-consistency
  // checked only, at construction) -- NOT cryptographically proven the way PreparedLaunch
  // proves its own binding via ExecutionBindingToken. A future consumer must not assume it.
  #outputPreparation: readonly OutputPreparationFileSlot[] | undefined;

  private constructor(
    input: Readonly<{
      invocationId: string;
      pin: Readonly<{ agentId: string; agentVersion: string; definitionDigest: string }>;
      workspaceDirectory: string;
      outputDirectory: string;
      reportedVersion: string;
      binding: ExecutionBinding;
      outputPreparation: readonly OutputPreparationFileSlot[];
    }>,
  ) {
    this.#token = Object.freeze({});
    this.invocationId = input.invocationId;
    this.pin = Object.freeze({ ...input.pin });
    this.workspaceDirectory = input.workspaceDirectory;
    this.outputDirectory = input.outputDirectory;
    this.reportedVersion = input.reportedVersion;
    this.binding = Object.freeze({
      ...input.binding,
      delivery: Object.freeze({ ...input.binding.delivery }),
    });
    this.#outputPreparation = input.outputPreparation;
    Object.freeze(this);
  }

  static create(
    input: Readonly<{
      invocationId: string;
      pin: Readonly<{ agentId: string; agentVersion: string; definitionDigest: string }>;
      workspaceDirectory: string;
      outputDirectory: string;
      reportedVersion: string;
      binding: ExecutionBinding;
      outputPreparation: readonly OutputPreparationFileSlot[];
    }>,
  ): PreparedInvocation {
    return new PreparedInvocation(input);
  }

  static takeOutputPreparation(invocation: unknown):
    | Readonly<{
        invocationId: string;
        outputDirectory: string;
        files: readonly OutputPreparationFileSlot[];
      }>
    | undefined {
    if (!PreparedInvocation.isAuthentic(invocation)) return undefined;
    const files = invocation.#outputPreparation;
    if (files === undefined) return undefined;
    invocation.#outputPreparation = undefined;
    return Object.freeze({
      invocationId: invocation.invocationId,
      outputDirectory: invocation.outputDirectory,
      files,
    });
  }

  static isAuthentic(invocation: unknown): invocation is PreparedInvocation {
    return (
      typeof invocation === 'object' &&
      invocation !== null &&
      #token in invocation &&
      invocation.#token !== undefined
    );
  }
}
