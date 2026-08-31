export type VersionOutputFailureReason =
  | 'invalid_utf8'
  | 'nul'
  | 'line_break'
  | 'surrounding_whitespace'
  | 'prefix_mismatch'
  | 'empty_version'
  | 'ambiguous_version'
  | 'control_character';

export type VersionOutputResult =
  | Readonly<{ valid: true; value: string }>
  | Readonly<{ valid: false; reason: VersionOutputFailureReason }>;

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const strictUtf8 = (bytes: Uint8Array): string | undefined => {
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

const containsLineBreak = (value: string): boolean =>
  value.includes('\r') ||
  value.includes('\n') ||
  value.includes('\u2028') ||
  value.includes('\u2029');

const splitLines = (value: string): readonly string[] => value.split(/\r\n|[\r\n\u2028\u2029]/u);

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if ((codePoint > 0 && codePoint < 32) || (codePoint >= 127 && codePoint <= 159)) return true;
  }
  return false;
};

const failure = (reason: VersionOutputFailureReason): VersionOutputResult =>
  Object.freeze({ reason, valid: false });

const validateEvidence = (value: string): VersionOutputResult | undefined => {
  if (value.length === 0) return failure('empty_version');
  if (containsControlCharacter(value)) return failure('control_character');
  if (value !== value.trim()) return failure('surrounding_whitespace');
  return undefined;
};

export const parseVersionOutput = (bytes: Uint8Array, prefix?: string): VersionOutputResult => {
  const decoded = strictUtf8(bytes);
  if (decoded === undefined) return failure('invalid_utf8');
  if (decoded.includes('\0')) return failure('nul');
  const normalized = stripOneTerminalNewline(decoded);
  if (prefix === undefined) {
    if (containsLineBreak(normalized)) return failure('line_break');
    const invalid = validateEvidence(normalized);
    return invalid ?? Object.freeze({ valid: true, value: normalized });
  }

  const matchingLines = splitLines(normalized).filter((line) => line.startsWith(prefix));
  if (matchingLines.length === 0) return failure('prefix_mismatch');
  if (matchingLines.length !== 1) return failure('ambiguous_version');
  const evidence = matchingLines[0]!.slice(prefix.length);
  const invalid = validateEvidence(evidence);
  return invalid ?? Object.freeze({ valid: true, value: evidence });
};
