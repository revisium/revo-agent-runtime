import { parseStrictSemVer } from '../../definition/index.js';
import type { StrictSemVer } from '../../definition/index.js';
import type { VersionOutputFailureReason } from './version-output-failure-reason.js';
import type { VersionOutputResult } from './version-output-result.js';

type VersionOutputInput = {
  readonly bytes: Uint8Array;
  readonly prefix?: string | undefined;
};

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const decodeStrictUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return decoder.decode(new Uint8Array(bytes));
  } catch {
    return undefined;
  }
};

const stripOneTerminalNewline = (value: string): string => {
  if (!value.endsWith('\n')) return value;

  const withoutLineFeed = value.slice(0, -1);
  return withoutLineFeed.endsWith('\r') ? withoutLineFeed.slice(0, -1) : withoutLineFeed;
};

const hasLineBreak = (value: string): boolean =>
  value.includes('\r') ||
  value.includes('\n') ||
  value.includes('\u2028') ||
  value.includes('\u2029');

const extractPrefixedVersion = (value: string, prefix: string | undefined): string | undefined => {
  if (prefix === undefined) return value;
  if (!value.startsWith(prefix)) return undefined;

  return value.slice(prefix.length);
};

const failure = (reason: VersionOutputFailureReason): VersionOutputResult =>
  Object.freeze({ valid: false, reason });

const success = (version: StrictSemVer): VersionOutputResult =>
  Object.freeze({ valid: true, version });

export const parseVersionOutput = (input: VersionOutputInput): VersionOutputResult => {
  const decoded = decodeStrictUtf8(input.bytes);
  if (decoded === undefined) return failure('invalid_utf8');
  if (decoded.includes('\0')) return failure('nul');

  const normalized = stripOneTerminalNewline(decoded);
  if (hasLineBreak(normalized)) return failure('line_break');
  if (normalized !== normalized.trim()) return failure('surrounding_whitespace');

  const versionSource = extractPrefixedVersion(normalized, input.prefix);
  if (versionSource === undefined) return failure('prefix_mismatch');
  if (versionSource.length === 0) return failure('empty_version');

  const version = parseStrictSemVer(versionSource);
  return version ? success(version) : failure('invalid_semver');
};
