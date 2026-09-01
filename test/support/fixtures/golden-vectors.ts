import { readFile } from 'node:fs/promises';

export interface GoldenVector {
  readonly name: string;
  readonly input: unknown;
  readonly canonicalUtf8Base64: string;
  readonly sha256: string;
}

interface GoldenVectors {
  readonly vectors: readonly GoldenVector[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isGoldenVector = (value: unknown): value is GoldenVector =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  'input' in value &&
  typeof value.canonicalUtf8Base64 === 'string' &&
  typeof value.sha256 === 'string';

const isGoldenVectors = (value: unknown): value is GoldenVectors =>
  isRecord(value) && Array.isArray(value.vectors) && value.vectors.every(isGoldenVector);

export const readAgentDefinitionGoldenVectors = async (): Promise<readonly GoldenVector[]> => {
  const parsed: unknown = JSON.parse(
    await readFile(
      new URL('../../contract/fixtures/agent-definition-v1.golden.json', import.meta.url),
      'utf8',
    ),
  );
  if (!isGoldenVectors(parsed))
    throw new TypeError('Invalid agent definition golden vector artifact');
  return parsed.vectors;
};
