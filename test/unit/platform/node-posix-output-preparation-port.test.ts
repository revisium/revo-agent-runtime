import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { NodePosixOutputPreparationPort } from '../../../src/platform/process/index.js';
import type {
  OutputPreparationFileSlot,
  OutputPreparationMutationRequest,
} from '../../../src/runtime/execution/index.js';
import { ConsumedOutputPreparationMaterial } from '../../../src/runtime/execution/output-preparation-attempt/consumed-output-preparation-material.js';
import { ConsumedRedactionMaterial } from '../../../src/runtime/execution/output-preparation-attempt/consumed-redaction-material.js';
import { RegisteredSecrets } from '../../../src/runtime/execution/secret-registration/registered-secrets.js';

let temporaryRoot: string | undefined;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

afterEach(async () => {
  vi.restoreAllMocks();
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

const createTemporaryOutputDirectory = async (): Promise<string> => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-output-preparation-'));
  const outputDirectory = join(temporaryRoot, 'invocation-output');
  await mkdir(outputDirectory);
  return outputDirectory;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const fileSlot = (
  slot: OutputPreparationFileSlot['slot'],
  contents: string,
  expectedSha256 = sha256(encoder.encode(contents)),
): OutputPreparationFileSlot => {
  const bytes = encoder.encode(contents);
  return Object.freeze({
    slot,
    path: `/ignored/${slot}`,
    bytes,
    expectedByteLength: bytes.byteLength,
    expectedSha256,
  });
};

const material = (
  outputDirectory: string,
  files: readonly OutputPreparationFileSlot[],
): ConsumedOutputPreparationMaterial =>
  ConsumedOutputPreparationMaterial.create({
    invocationId: 'output-preparation',
    outputDirectory,
    invocationToken: Object.freeze({}),
    files,
  });

const redaction = (): ConsumedRedactionMaterial =>
  ConsumedRedactionMaterial.create({
    invocationId: 'output-preparation',
    invocationToken: Object.freeze({}),
    redaction: RegisteredSecrets.create(['secret-value']),
  });

const request = (
  outputDirectory: string,
  files: readonly OutputPreparationFileSlot[],
  markMutationDispatched = vi.fn(),
): OutputPreparationMutationRequest =>
  Object.freeze({
    invocationId: 'output-preparation',
    outputDirectory,
    material: material(outputDirectory, files),
    redaction: redaction(),
    markMutationDispatched,
  });

const expectZeroFilled = (bytes: Uint8Array): void => {
  expect([...bytes]).toEqual(new Array<number>(bytes.byteLength).fill(0));
};

const modeBits = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

type PartialOutputPreparationRequest = Partial<
  Record<keyof OutputPreparationMutationRequest, unknown>
>;

const prepareFromPartial = (
  port: NodePosixOutputPreparationPort,
  partialRequest: PartialOutputPreparationRequest,
) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  port.prepareClaimedOutput(partialRequest as OutputPreparationMutationRequest);

const expectOwnerOnlyMode = async (path: string, requestedMode: number): Promise<void> => {
  expect((await modeBits(path)) & ~requestedMode).toBe(0);
};

test('reports scratch conflict when the scratch directory already exists', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  await mkdir(join(outputDirectory, '.scratch'));
  const markMutationDispatched = vi.fn();
  const prompt = fileSlot('prompt', 'hello');
  const port = new NodePosixOutputPreparationPort();

  await expect(
    port.prepareClaimedOutput(request(outputDirectory, [prompt], markMutationDispatched)),
  ).resolves.toEqual({ status: 'rejected', reason: 'scratch_conflict' });
  expect(markMutationDispatched).toHaveBeenCalledOnce();
  expectZeroFilled(prompt.bytes);
});

test('reports scratch conflict when a scratch slot target is claimed twice', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  const firstPrompt = fileSlot('prompt', 'first');
  const secondPrompt = fileSlot('prompt', 'second');
  const port = new NodePosixOutputPreparationPort();

  await expect(
    port.prepareClaimedOutput(request(outputDirectory, [firstPrompt, secondPrompt])),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'scratch_conflict',
  });
  expectZeroFilled(firstPrompt.bytes);
  expectZeroFilled(secondPrompt.bytes);
  await expect(lstat(join(outputDirectory, '.scratch', 'prompt.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('writes byte-exact scratch files with owner-only modes and attestations', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  const prompt = fileSlot('prompt', 'prompt without newline');
  const schema = fileSlot('result-schema', '{"type":"object"}');
  const markMutationDispatched = vi.fn();
  const port = new NodePosixOutputPreparationPort();

  const result = await port.prepareClaimedOutput(
    request(outputDirectory, [prompt, schema], markMutationDispatched),
  );

  expect(result.status).toBe('prepared');
  if (result.status !== 'prepared') throw new Error('Expected prepared result.');
  const promptPath = join(outputDirectory, '.scratch', 'prompt.txt');
  const schemaPath = join(outputDirectory, '.scratch', 'result-schema.json');
  await expect(readFile(promptPath, 'utf8')).resolves.toBe('prompt without newline');
  await expect(readFile(schemaPath, 'utf8')).resolves.toBe('{"type":"object"}');
  await expectOwnerOnlyMode(join(outputDirectory, '.scratch'), 0o700);
  await expectOwnerOnlyMode(promptPath, 0o600);
  await expectOwnerOnlyMode(schemaPath, 0o600);
  expect(result.attestations).toEqual([
    {
      slot: 'prompt',
      path: promptPath,
      byteLength: 22,
      sha256: sha256(encoder.encode('prompt without newline')),
    },
    {
      slot: 'result-schema',
      path: schemaPath,
      byteLength: 17,
      sha256: sha256(encoder.encode('{"type":"object"}')),
    },
  ]);
  expect(markMutationDispatched).toHaveBeenCalledOnce();
  expectZeroFilled(prompt.bytes);
  expectZeroFilled(schema.bytes);
});

test('rejects a mismatched expected sha256 without returning an attestation', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  const prompt = fileSlot('prompt', 'wrong-hash', '0'.repeat(64));
  const port = new NodePosixOutputPreparationPort();

  const result = await port.prepareClaimedOutput(request(outputDirectory, [prompt]));

  expect(result).toEqual({ status: 'rejected', reason: 'scratch_write_failed' });
  expectZeroFilled(prompt.bytes);
});

test('returns independent redaction fronts with non-shared carry state', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  const result = await new NodePosixOutputPreparationPort().prepareClaimedOutput(
    request(outputDirectory, []),
  );

  expect(result.status).toBe('prepared');
  if (result.status !== 'prepared') throw new Error('Expected prepared result.');
  expect(result.frontEnds.stdout).not.toBe(result.frontEnds.stderr);
  expect(result.frontEnds.stdout).not.toBe(result.frontEnds.rawResponse);
  expect(decoder.decode(result.frontEnds.stdout.feed(encoder.encode('secret-')))).toBe('');
  expect(decoder.decode(result.frontEnds.stderr.feed(encoder.encode('plain')))).toBe('plain');
  expect(decoder.decode(result.frontEnds.rawResponse.feed(encoder.encode('secret-value')))).toBe(
    '[REDACTED]',
  );
  expect(decoder.decode(result.frontEnds.stdout.feed(encoder.encode('value')))).toBe('[REDACTED]');
  expect(decoder.decode(result.frontEnds.stderr.flush())).toBe('');
});

test('zero-fills processed and unprocessed slot buffers when a later slot conflicts', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  const firstPrompt = fileSlot('prompt', 'first');
  const secondPrompt = fileSlot('prompt', 'second');
  const port = new NodePosixOutputPreparationPort();

  const result = await port.prepareClaimedOutput(
    request(outputDirectory, [firstPrompt, secondPrompt]),
  );

  expect(result).toEqual({ status: 'rejected', reason: 'scratch_conflict' });
  expectZeroFilled(firstPrompt.bytes);
  expectZeroFilled(secondPrompt.bytes);
  await expect(lstat(join(outputDirectory, '.scratch', 'prompt.txt'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('rejects unauthentic consumed materials before mutation dispatch', async () => {
  const outputDirectory = await createTemporaryOutputDirectory();
  const markMutationDispatched = vi.fn();
  const malformed = Object.freeze({
    invocationId: 'output-preparation',
    outputDirectory,
    material: Object.freeze({}),
    redaction: redaction(),
    markMutationDispatched,
  }) satisfies PartialOutputPreparationRequest;

  await expect(
    prepareFromPartial(new NodePosixOutputPreparationPort(), malformed),
  ).resolves.toEqual({
    status: 'rejected',
    reason: 'scratch_create_failed',
  });
  expect(markMutationDispatched).not.toHaveBeenCalled();
  await expect(lstat(join(outputDirectory, '.scratch'))).rejects.toMatchObject({ code: 'ENOENT' });
});
