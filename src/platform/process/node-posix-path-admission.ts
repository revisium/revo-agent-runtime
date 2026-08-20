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

const isInvalidOutputLeafPath = (path: string): boolean =>
  isInvalidNormalizedAbsolutePosixPath(path) || path.endsWith('/');

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const isExistingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

export const nodePosixPathAdmission = Object.freeze({
  isInvalidNormalizedAbsolutePosixPath,
  isInvalidOutputLeafPath,
  isMissingPathError,
  isExistingPathError,
});
