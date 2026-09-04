import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const readArtifactJson = async (name: string): Promise<unknown> => {
  const raw = await readFile(
    new URL(`../../../../contract/fixtures/session/${name}`, import.meta.url),
    'utf8',
  );
  if (Buffer.byteLength(raw, 'utf8') > 1_048_576)
    throw new RangeError('Session fixture exceeds the reader byte bound.');
  return JSON.parse(raw);
};

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const readArtifactDigest = async (name: string): Promise<string> =>
  (
    await readFile(
      new URL(`../../../../contract/fixtures/session/${name}`, import.meta.url),
      'utf8',
    )
  ).trim();
