import { posix } from 'node:path';

const maximumPosixPathBytes = 4_096;
const encoder = new TextEncoder();

const isInvalidNormalizedAbsolutePosixPath = (path: string): boolean =>
  path.length === 0 ||
  path.length > maximumPosixPathBytes ||
  encoder.encode(path).byteLength > maximumPosixPathBytes ||
  path.includes('\0') ||
  !path.startsWith('/') ||
  path !== posix.normalize(path);

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const nodePosixPathAdmission = Object.freeze({
  isInvalidNormalizedAbsolutePosixPath,
  isMissingPathError,
});
