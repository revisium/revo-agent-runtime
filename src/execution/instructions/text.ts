const maximumInstructionBytes = 262_000;
const encoder = new TextEncoder();

/** Instruction text is portable prose: empty equals omitted; objects and NUL are rejected. */
export const snapshotInstructions = (value: unknown): string | undefined => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new TypeError('Instructions must be a string.');
  if (value.includes('\0')) throw new TypeError('Instructions must not contain NUL.');
  if (encoder.encode(value).byteLength > maximumInstructionBytes)
    throw new TypeError('Instructions exceed their byte limit.');
  return value;
};
