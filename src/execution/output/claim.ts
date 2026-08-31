import { dirname, isAbsolute, normalize } from 'node:path';

export type DirectoryInspection = 'directory' | 'missing' | 'not_directory' | 'uncertain';

export type ExclusiveDirectoryCreation = 'created' | 'conflict' | 'invalid_path' | 'uncertain';

/** Filesystem facts used while admitting one consumer-provided output leaf. */
export interface OutputClaimPlatform {
  inspectDirectory(path: string): Promise<DirectoryInspection>;
  createExclusiveDirectory(path: string): Promise<ExclusiveDirectoryCreation>;
}

export type OutputClaimRejection = 'workspace_invalid' | 'output_path_invalid' | 'output_conflict';

type OutputClaimResult =
  | Readonly<{ status: 'claimed'; output: ClaimedInvocationOutput }>
  | Readonly<{ status: 'rejected'; reason: OutputClaimRejection }>
  | Readonly<{ status: 'uncertain' }>;

interface ClaimState {
  phase: 'available' | 'publishing' | 'finished';
}

const claimStates = new WeakMap<ClaimedInvocationOutput, ClaimState>();

/**
 * A package-private capability for the newly created output leaf. Its constructor
 * is private so a caller cannot turn an arbitrary directory into publication authority.
 */
export class ClaimedInvocationOutput {
  readonly #directory: string;

  private constructor(directory: string) {
    this.#directory = directory;
    claimStates.set(this, { phase: 'available' });
    Object.freeze(this);
  }

  static create(directory: string): ClaimedInvocationOutput {
    return new ClaimedInvocationOutput(directory);
  }

  static beginPublication(value: unknown): OutputPublicationLease | undefined {
    if (!(value instanceof ClaimedInvocationOutput)) return undefined;
    const state = claimStates.get(value);
    if (state?.phase !== 'available') return undefined;
    state.phase = 'publishing';
    let finished = false;
    return Object.freeze({
      directory: value.#directory,
      finish: () => {
        if (finished) return;
        finished = true;
        state.phase = 'finished';
      },
    });
  }
}

export interface OutputPublicationLease {
  readonly directory: string;
  finish(): void;
}

/** Acquires the one publication turn for an authentic, still-open claim. */
export const beginOutputPublication = (value: unknown): OutputPublicationLease | undefined => {
  return ClaimedInvocationOutput.beginPublication(value);
};

const normalizedAbsolutePath = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)) return undefined;
  const normalized = normalize(value);
  return normalized.length === 0 || normalized !== value ? undefined : normalized;
};

const isDirectory = async (
  platform: OutputClaimPlatform,
  path: string,
): Promise<boolean | undefined> => {
  try {
    const inspection = await platform.inspectDirectory(path);
    if (inspection === 'directory') return true;
    if (inspection === 'uncertain') return undefined;
    return false;
  } catch {
    return undefined;
  }
};

export type OutputClaimPreparation =
  | Readonly<{ status: 'prepared'; output: PreparedInvocationOutput }>
  | Readonly<{ status: 'rejected'; reason: Exclude<OutputClaimRejection, 'output_conflict'> }>
  | Readonly<{ status: 'uncertain' }>;

interface PreparationState {
  phase: 'available' | 'claiming' | 'claimed';
}

/**
 * A package-private admission capability. It confirms paths without mutating the
 * filesystem, then permits one exclusive leaf creation after executable proof.
 */
class PreparedInvocationOutput {
  readonly #platform: OutputClaimPlatform;
  readonly #outputDirectory: string;
  readonly #state: PreparationState = { phase: 'available' };

  private constructor(platform: OutputClaimPlatform, outputDirectory: string) {
    this.#platform = platform;
    this.#outputDirectory = outputDirectory;
    Object.freeze(this);
  }

  static create(platform: OutputClaimPlatform, outputDirectory: string): PreparedInvocationOutput {
    return new PreparedInvocationOutput(platform, outputDirectory);
  }

  async claim(): Promise<OutputClaimResult> {
    if (this.#state.phase !== 'available') return Object.freeze({ status: 'uncertain' });
    this.#state.phase = 'claiming';
    let created: ExclusiveDirectoryCreation;
    try {
      created = await this.#platform.createExclusiveDirectory(this.#outputDirectory);
    } catch {
      return Object.freeze({ status: 'uncertain' });
    } finally {
      this.#state.phase = 'claimed';
    }
    if (created === 'created')
      return Object.freeze({
        status: 'claimed',
        output: ClaimedInvocationOutput.create(this.#outputDirectory),
      });
    if (created === 'conflict')
      return Object.freeze({ status: 'rejected', reason: 'output_conflict' });
    if (created === 'invalid_path')
      return Object.freeze({ status: 'rejected', reason: 'output_path_invalid' });
    return Object.freeze({ status: 'uncertain' });
  }
}

/** Validates normalized absolute workspace and output parent without claiming the leaf. */
export const prepareOutputClaim = async (
  platform: OutputClaimPlatform,
  input: Readonly<{ workspace: unknown; outputDirectory: unknown }>,
): Promise<OutputClaimPreparation> => {
  const workspace = normalizedAbsolutePath(input.workspace);
  if (workspace === undefined)
    return Object.freeze({ status: 'rejected', reason: 'workspace_invalid' });
  const workspaceExists = await isDirectory(platform, workspace);
  if (workspaceExists === undefined) return Object.freeze({ status: 'uncertain' });
  if (!workspaceExists) return Object.freeze({ status: 'rejected', reason: 'workspace_invalid' });

  const outputDirectory = normalizedAbsolutePath(input.outputDirectory);
  if (outputDirectory === undefined || dirname(outputDirectory) === outputDirectory)
    return Object.freeze({ status: 'rejected', reason: 'output_path_invalid' });
  const parentExists = await isDirectory(platform, dirname(outputDirectory));
  if (parentExists === undefined) return Object.freeze({ status: 'uncertain' });
  if (!parentExists) return Object.freeze({ status: 'rejected', reason: 'output_path_invalid' });

  return Object.freeze({
    status: 'prepared',
    output: PreparedInvocationOutput.create(platform, outputDirectory),
  });
};
