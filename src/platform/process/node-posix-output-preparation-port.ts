import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createRedactionChannel,
  revealRegisteredSecrets,
  takeOutputPreparationFileSlots,
  takeRegisteredSecretsForRedaction,
  type OutputPreparationFileAttestation,
  type OutputPreparationFileSlot,
  type OutputPreparationMutationPort,
  type OutputPreparationMutationRequest,
  type OutputPreparationPlatformResult,
  type RedactionChannel,
} from '../../runtime/execution/index.js';
import { nodePosixPathAdmission } from './node-posix-path-admission.js';

type OutputPreparationFrontEnds = Readonly<{
  stdout: RedactionChannel;
  stderr: RedactionChannel;
  rawResponse: RedactionChannel;
}>;

type RejectionReason = Extract<OutputPreparationPlatformResult, { status: 'rejected' }>['reason'];

const rejected = (reason: RejectionReason): OutputPreparationPlatformResult =>
  Object.freeze({ status: 'rejected', reason });

const slotFileName = (slot: OutputPreparationFileSlot['slot']): string =>
  slot === 'prompt' ? 'prompt.txt' : 'result-schema.json';

const disposeFrontEnds = (frontEnds: OutputPreparationFrontEnds | undefined): void => {
  frontEnds?.stdout.dispose();
  frontEnds?.stderr.dispose();
  frontEnds?.rawResponse.dispose();
};

const zeroFillSlots = (slots: readonly OutputPreparationFileSlot[], start = 0): void => {
  for (let index = start; index < slots.length; index += 1) slots[index]?.bytes.fill(0);
};

const buildFrontEnds = (
  secretValues: readonly string[],
): OutputPreparationFrontEnds | undefined => {
  const created: RedactionChannel[] = [];
  try {
    const stdout = createRedactionChannel(secretValues);
    created.push(stdout);
    const stderr = createRedactionChannel(secretValues);
    created.push(stderr);
    const rawResponse = createRedactionChannel(secretValues);
    return Object.freeze({ stdout, stderr, rawResponse });
  } catch {
    for (const channel of created) channel.dispose();
    return undefined;
  }
};

const attestationFor = (
  slot: OutputPreparationFileSlot,
  path: string,
): OutputPreparationFileAttestation | undefined => {
  const sha256 = createHash('sha256').update(slot.bytes).digest('hex');
  if (sha256 !== slot.expectedSha256 || slot.bytes.byteLength !== slot.expectedByteLength)
    return undefined;
  return Object.freeze({ slot: slot.slot, path, byteLength: slot.bytes.byteLength, sha256 });
};

const removeBestEffort = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch {
    // Best-effort rollback must never mask the original preparation reason.
  }
};

export class NodePosixOutputPreparationPort implements OutputPreparationMutationPort {
  async prepareClaimedOutput(
    request: OutputPreparationMutationRequest,
  ): Promise<OutputPreparationPlatformResult> {
    let files: readonly OutputPreparationFileSlot[] | undefined;
    let frontEnds: OutputPreparationFrontEnds | undefined;
    try {
      files = takeOutputPreparationFileSlots(request.material);
      const secrets = takeRegisteredSecretsForRedaction(request.redaction);
      if (files === undefined || secrets === undefined) {
        if (files !== undefined) zeroFillSlots(files);
        return rejected('scratch_create_failed');
      }

      const secretValues = revealRegisteredSecrets(secrets) ?? [];
      frontEnds = buildFrontEnds(secretValues);
      if (frontEnds === undefined) {
        zeroFillSlots(files);
        return rejected('redaction_sink_create_failed');
      }

      request.markMutationDispatched();
      const scratchDirectory = join(request.outputDirectory, '.scratch');
      try {
        await mkdir(scratchDirectory, { mode: 0o700 });
      } catch (error: unknown) {
        disposeFrontEnds(frontEnds);
        zeroFillSlots(files);
        return rejected(
          nodePosixPathAdmission.isExistingPathError(error)
            ? 'scratch_conflict'
            : 'scratch_create_failed',
        );
      }

      const attestations: OutputPreparationFileAttestation[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const slot = files[index];
        if (slot === undefined) continue;
        const path = join(scratchDirectory, slotFileName(slot.slot));
        // oxlint-disable-next-line no-await-in-loop -- slots must be written and zero-filled in deterministic ownership order.
        const failure = await this.writeAndAttestSlot(slot, path, attestations);
        if (failure !== undefined) {
          // oxlint-disable-next-line no-await-in-loop -- rollback belongs to the failing slot before later buffers are released.
          await removeBestEffort(path);
          disposeFrontEnds(frontEnds);
          slot.bytes.fill(0);
          zeroFillSlots(files, index + 1);
          return rejected(failure);
        }
        slot.bytes.fill(0);
      }

      return Object.freeze({
        status: 'prepared',
        attestations: Object.freeze(attestations),
        frontEnds,
      });
    } catch {
      disposeFrontEnds(frontEnds);
      if (files !== undefined) zeroFillSlots(files);
      return rejected('scratch_create_failed');
    }
  }

  private async writeAndAttestSlot(
    slot: OutputPreparationFileSlot,
    path: string,
    attestations: OutputPreparationFileAttestation[],
  ): Promise<RejectionReason | undefined> {
    try {
      await writeFile(path, slot.bytes, { flag: 'wx', mode: 0o600 });
    } catch (error: unknown) {
      return nodePosixPathAdmission.isExistingPathError(error)
        ? 'scratch_conflict'
        : 'scratch_create_failed';
    }
    const attestation = attestationFor(slot, path);
    if (attestation === undefined) return 'scratch_write_failed';
    attestations.push(attestation);
    return undefined;
  }
}
