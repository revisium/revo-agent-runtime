import type { RedactionChannel } from './redaction-channel.js';

const encoder = new TextEncoder();
const REDACTED = encoder.encode('[REDACTED]');
const KEY_NAMES = [
  'API_KEY',
  'API_TOKEN',
  'ACCESS_TOKEN',
  'AUTH_TOKEN',
  'CLIENT_SECRET',
  'PASSWORD',
] as const;
const HEADER_NAMES = ['Authorization', 'Proxy-Authorization'] as const;
const BEARER = encoder.encode('Bearer');
const PEM_BEGIN = encoder.encode('-----BEGIN ');
const PRIVATE_KEY_SUFFIX = encoder.encode(' PRIVATE KEY-----');
const CARRY_LIMIT = 65_536;
const TOKEN_DELIMITERS = [9, 32, 44, 59, 38, 13, 10] as const;

type DiscardRule =
  | Readonly<{ kind: 'byte'; delimiters: readonly number[] }>
  | Readonly<{ kind: 'byte-after-ows'; grammar: 'key-value' | 'bearer' }>
  | Readonly<{ kind: 'sequence'; delimiter: Uint8Array }>;

type CompleteCandidate = Readonly<{
  state: 'complete';
  end: number;
  replacement: Uint8Array;
}>;

type IncompleteCandidate =
  | Readonly<{
      state: 'incomplete';
      active: false;
      replacement: Uint8Array;
    }>
  | Readonly<{
      state: 'incomplete';
      active: true;
      replacement: Uint8Array;
      discardRule: DiscardRule;
    }>;

type Candidate = CompleteCandidate | IncompleteCandidate;

const concatBytes = (...parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const asciiLower = (byte: number): number => (byte >= 65 && byte <= 90 ? byte + 32 : byte);

const isAsciiEqual = (left: number, right: number): boolean =>
  asciiLower(left) === asciiLower(right);

const isIdentifierByte = (byte: number): boolean =>
  (byte >= 48 && byte <= 57) ||
  (byte >= 65 && byte <= 90) ||
  byte === 95 ||
  (byte >= 97 && byte <= 122);

const isOws = (byte: number): boolean => byte === 32 || byte === 9;
const skipOws = (input: Uint8Array, start: number): number => {
  let offset = start;
  while (isOws(input[offset] ?? 0)) offset += 1;
  return offset;
};
const isLineDelimiter = (byte: number): boolean => byte === 13 || byte === 10;
const isTokenDelimiter = (byte: number): boolean =>
  isOws(byte) || byte === 44 || byte === 59 || byte === 38 || isLineDelimiter(byte);

const hasBoundaryBefore = (input: Uint8Array, start: number): boolean =>
  start === 0 || !isIdentifierByte(input[start - 1] ?? 0);

const matchSequence = (
  input: Uint8Array,
  start: number,
  expected: Uint8Array,
  caseInsensitive: boolean,
): 'none' | 'partial' | 'full' => {
  const available = input.byteLength - start;
  const compared = Math.min(available, expected.byteLength);
  for (let index = 0; index < compared; index += 1) {
    const actual = input[start + index] ?? 0;
    const wanted = expected[index] ?? 0;
    if (caseInsensitive ? !isAsciiEqual(actual, wanted) : actual !== wanted) return 'none';
  }
  return available < expected.byteLength ? 'partial' : 'full';
};

const replacementWithPrefix = (
  input: Uint8Array,
  start: number,
  prefixEnd: number,
  suffix: Uint8Array = new Uint8Array(),
): Uint8Array => concatBytes(input.subarray(start, prefixEnd), REDACTED, suffix);

const parseQuotedKeyValue = (
  input: Uint8Array,
  start: number,
  quoteStart: number,
  quote: number,
): Candidate => {
  const quotedPrefixEnd = quoteStart + 1;
  let end = quotedPrefixEnd;
  while (input[end] !== undefined && input[end] !== quote) end += 1;
  if (input[end] === undefined)
    return {
      state: 'incomplete',
      active: true,
      replacement: replacementWithPrefix(input, start, quotedPrefixEnd),
      discardRule: { kind: 'byte', delimiters: [quote] },
    };
  return {
    state: 'complete',
    end: end + 1,
    replacement: replacementWithPrefix(input, start, quotedPrefixEnd, new Uint8Array([quote])),
  };
};

const parseUnquotedKeyValue = (
  input: Uint8Array,
  start: number,
  valueStart: number,
): Candidate | undefined => {
  const firstValueByte = input[valueStart];
  if (firstValueByte === undefined)
    return {
      state: 'incomplete',
      active: true,
      replacement: replacementWithPrefix(input, start, valueStart),
      discardRule: { kind: 'byte-after-ows', grammar: 'key-value' },
    };
  if (isTokenDelimiter(firstValueByte)) return undefined;

  let end = valueStart + 1;
  while (input[end] !== undefined && !isTokenDelimiter(input[end] ?? 0)) end += 1;
  const replacement = replacementWithPrefix(input, start, valueStart);
  if (input[end] === undefined)
    return {
      state: 'incomplete',
      active: true,
      replacement,
      discardRule: { kind: 'byte', delimiters: TOKEN_DELIMITERS },
    };
  return { state: 'complete', end, replacement };
};

const parseKeyValue = (input: Uint8Array, start: number, key: string): Candidate | undefined => {
  if (!hasBoundaryBefore(input, start)) return undefined;
  const keyBytes = encoder.encode(key);
  const keyMatch = matchSequence(input, start, keyBytes, true);
  if (keyMatch === 'none') return undefined;
  if (keyMatch === 'partial') return { state: 'incomplete', active: false, replacement: REDACTED };

  let offset = start + keyBytes.byteLength;
  const next = input[offset];
  if (next !== undefined && isIdentifierByte(next)) return undefined;
  offset = skipOws(input, offset);
  if (input[offset] === undefined)
    return { state: 'incomplete', active: false, replacement: REDACTED };
  if (input[offset] !== 61 && input[offset] !== 58) return undefined;
  const valueStart = skipOws(input, offset + 1);
  const firstValueByte = input[valueStart];
  if (firstValueByte === 34 || firstValueByte === 39)
    return parseQuotedKeyValue(input, start, valueStart, firstValueByte);
  return parseUnquotedKeyValue(input, start, valueStart);
};

const parseHeader = (input: Uint8Array, start: number, name: string): Candidate | undefined => {
  if (!hasBoundaryBefore(input, start)) return undefined;
  const nameBytes = encoder.encode(name);
  const nameMatch = matchSequence(input, start, nameBytes, true);
  if (nameMatch === 'none') return undefined;
  if (nameMatch === 'partial') return { state: 'incomplete', active: false, replacement: REDACTED };

  let offset = start + nameBytes.byteLength;
  while (true) {
    const byte = input[offset];
    if (byte === undefined || !isOws(byte)) break;
    offset += 1;
  }
  if (input[offset] === undefined)
    return { state: 'incomplete', active: false, replacement: REDACTED };
  if (input[offset] !== 58) return undefined;
  offset += 1;
  while (true) {
    const byte = input[offset];
    if (byte === undefined || !isOws(byte)) break;
    offset += 1;
  }
  const prefixEnd = offset;
  while (true) {
    const byte = input[offset];
    if (byte === undefined || isLineDelimiter(byte)) break;
    offset += 1;
  }
  const replacement = replacementWithPrefix(input, start, prefixEnd);
  return input[offset] === undefined
    ? {
        state: 'incomplete',
        active: true,
        replacement,
        discardRule: { kind: 'byte', delimiters: [13, 10] },
      }
    : { state: 'complete', end: offset, replacement };
};

const parseBearer = (input: Uint8Array, start: number): Candidate | undefined => {
  if (!hasBoundaryBefore(input, start)) return undefined;
  const match = matchSequence(input, start, BEARER, false);
  if (match === 'none') return undefined;
  if (match === 'partial') return { state: 'incomplete', active: false, replacement: REDACTED };

  let offset = start + BEARER.byteLength;
  if (input[offset] === undefined)
    return { state: 'incomplete', active: false, replacement: REDACTED };
  const firstWhitespace = input[offset];
  if (firstWhitespace === undefined || !isOws(firstWhitespace)) return undefined;
  while (true) {
    const byte = input[offset];
    if (byte === undefined || !isOws(byte)) break;
    offset += 1;
  }
  const prefixEnd = offset;
  if (input[offset] === undefined)
    return {
      state: 'incomplete',
      active: true,
      replacement: replacementWithPrefix(input, start, prefixEnd),
      discardRule: { kind: 'byte-after-ows', grammar: 'bearer' },
    };
  const firstTokenByte = input[offset];
  if (firstTokenByte === undefined || isTokenDelimiter(firstTokenByte)) return undefined;
  offset += 1;
  while (true) {
    const byte = input[offset];
    if (byte === undefined || isTokenDelimiter(byte)) break;
    offset += 1;
  }
  const replacement = replacementWithPrefix(input, start, prefixEnd);
  return input[offset] === undefined
    ? {
        state: 'incomplete',
        active: true,
        replacement,
        discardRule: { kind: 'byte', delimiters: TOKEN_DELIMITERS },
      }
    : { state: 'complete', end: offset, replacement };
};

const indexOfSequence = (input: Uint8Array, expected: Uint8Array, from: number): number => {
  for (let start = from; start + expected.byteLength <= input.byteLength; start += 1) {
    if (matchSequence(input, start, expected, false) === 'full') return start;
  }
  return -1;
};

const isPemLabelByte = (byte: number): boolean =>
  byte === 32 || (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90);

const parsePem = (input: Uint8Array, start: number): Candidate | undefined => {
  const beginMatch = matchSequence(input, start, PEM_BEGIN, false);
  if (beginMatch === 'none') return undefined;
  if (beginMatch === 'partial')
    return { state: 'incomplete', active: false, replacement: REDACTED };

  const labelStart = start + PEM_BEGIN.byteLength;
  const suffixStart = indexOfSequence(input, PRIVATE_KEY_SUFFIX, labelStart);
  if (suffixStart < 0) {
    if (input.byteLength - start > 128) return undefined;
    return { state: 'incomplete', active: false, replacement: REDACTED };
  }
  const label = input.subarray(labelStart, suffixStart);
  if (label.byteLength === 0 || label.some((byte) => !isPemLabelByte(byte))) return undefined;
  const beginEnd = suffixStart + PRIVATE_KEY_SUFFIX.byteLength;
  if (beginEnd - start > 128) return undefined;
  const endDelimiter = concatBytes(encoder.encode('-----END '), label, PRIVATE_KEY_SUFFIX);
  const endStart = indexOfSequence(input, endDelimiter, beginEnd);
  return endStart < 0
    ? {
        state: 'incomplete',
        active: true,
        replacement: REDACTED,
        discardRule: { kind: 'sequence', delimiter: endDelimiter },
      }
    : { state: 'complete', end: endStart + endDelimiter.byteLength, replacement: REDACTED };
};

const candidatesAt = (
  input: Uint8Array,
  start: number,
  secretBytes: readonly Uint8Array[],
): readonly Candidate[] => {
  const candidates: Candidate[] = [];
  for (const secret of secretBytes) {
    const match = matchSequence(input, start, secret, false);
    if (match === 'partial')
      candidates.push({ state: 'incomplete', active: false, replacement: REDACTED });
    if (match === 'full')
      candidates.push({ state: 'complete', end: start + secret.byteLength, replacement: REDACTED });
  }
  for (const key of KEY_NAMES) {
    const candidate = parseKeyValue(input, start, key);
    if (candidate !== undefined) candidates.push(candidate);
  }
  for (const header of HEADER_NAMES) {
    const candidate = parseHeader(input, start, header);
    if (candidate !== undefined) candidates.push(candidate);
  }
  const bearer = parseBearer(input, start);
  if (bearer !== undefined) candidates.push(bearer);
  const pem = parsePem(input, start);
  if (pem !== undefined) candidates.push(pem);
  return candidates;
};

type Processed =
  | Readonly<{ state: 'released'; output: Uint8Array }>
  | Readonly<{
      state: 'retained';
      start: number;
      candidate: IncompleteCandidate;
    }>;

interface RankedCandidate {
  readonly candidate: CompleteCandidate;
  readonly priority: number;
}

const candidatePriority = (candidate: Candidate): number => {
  if (candidate.state === 'complete') return 2;
  if (candidate.active) return 1;
  return 0;
};

const applicableCandidate = (
  candidate: Candidate,
  inputLength: number,
  final: boolean,
): RankedCandidate | undefined => {
  if (candidate.state === 'complete') return { candidate, priority: candidatePriority(candidate) };
  if (!final) return undefined;
  return {
    candidate: { state: 'complete', end: inputLength, replacement: candidate.replacement },
    priority: candidatePriority(candidate),
  };
};

const isPreferredCandidate = (
  candidate: RankedCandidate,
  current: RankedCandidate | undefined,
): boolean => {
  if (current === undefined) return true;
  if (candidate.candidate.end > current.candidate.end) return true;
  if (candidate.candidate.end < current.candidate.end) return false;
  return candidate.priority > current.priority;
};

const selectBestCandidate = (
  candidates: readonly Candidate[],
  inputLength: number,
  final: boolean,
): CompleteCandidate | undefined => {
  let best: RankedCandidate | undefined;
  for (const candidate of candidates) {
    const applicable = applicableCandidate(candidate, inputLength, final);
    if (applicable !== undefined && isPreferredCandidate(applicable, best)) best = applicable;
  }
  return best?.candidate;
};

const processCarry = (
  input: Uint8Array,
  secretBytes: readonly Uint8Array[],
  final: boolean,
): Processed => {
  const output: Uint8Array[] = [];
  let safeStart = 0;
  let offset = 0;
  while (offset < input.byteLength) {
    const candidates = candidatesAt(input, offset, secretBytes);
    const incomplete = candidates.find((candidate) => candidate.state === 'incomplete');
    if (!final && incomplete !== undefined)
      return { state: 'retained', start: offset, candidate: incomplete };
    const complete = selectBestCandidate(candidates, input.byteLength, final);
    if (complete === undefined) {
      offset += 1;
      continue;
    }
    output.push(input.subarray(safeStart, offset), complete.replacement);
    offset = complete.end;
    safeStart = complete.end;
  }
  output.push(input.subarray(safeStart));
  return { state: 'released', output: concatBytes(...output) };
};

export const createRedactionChannel = (secretValues: readonly string[]): RedactionChannel => {
  const secretBytes = secretValues
    .filter((value) => value.length > 0)
    .map((value) => encoder.encode(value));
  let carry: Uint8Array = new Uint8Array();
  let discardRule: DiscardRule | undefined;
  let discardCarry: Uint8Array = new Uint8Array();
  let disposed = false;

  const assertActive = (): void => {
    if (disposed) throw new Error('Redaction channel is disposed.');
  };

  const replaceCarry = (next: Uint8Array): void => {
    const retired = carry;
    if (retired.byteLength > 0) retired.fill(0);
    carry = next;
  };

  const replaceDiscardCarry = (next: Uint8Array): void => {
    const retired = discardCarry;
    if (retired.byteLength > 0) retired.fill(0);
    discardCarry = next;
  };

  const feedNormal = (chunk: Uint8Array): Uint8Array => {
    const combined = concatBytes(carry, chunk);
    replaceCarry(combined);
    const processed = processCarry(carry, secretBytes, false);
    if (processed.state === 'released') {
      const output = processed.output.slice();
      replaceCarry(new Uint8Array());
      return output;
    }
    if (carry.byteLength - processed.start <= CARRY_LIMIT) return new Uint8Array();
    if (!processed.candidate.active) {
      const safe = carry.slice(0, processed.start);
      const retained = carry.slice(processed.start);
      replaceCarry(retained);
      return safe;
    }
    const output = concatBytes(carry.subarray(0, processed.start), processed.candidate.replacement);
    replaceCarry(new Uint8Array());
    discardRule = processed.candidate.discardRule;
    return output;
  };

  const retainedDelimiterPrefix = (input: Uint8Array, delimiter: Uint8Array): Uint8Array => {
    const maximum = Math.min(input.byteLength, delimiter.byteLength - 1);
    for (let length = maximum; length > 0; length -= 1) {
      const suffix = input.subarray(input.byteLength - length);
      if (matchSequence(suffix, 0, delimiter.subarray(0, length), false) === 'full')
        return suffix.slice();
    }
    return new Uint8Array();
  };

  const discardUntilByteDelimiter = (
    delimiters: readonly number[],
    searchStart: number,
  ): Uint8Array => {
    const relativeDelimiterIndex = discardCarry
      .subarray(searchStart)
      .findIndex((byte) => delimiters.includes(byte));
    const delimiterIndex = relativeDelimiterIndex < 0 ? -1 : searchStart + relativeDelimiterIndex;
    if (delimiterIndex < 0) {
      replaceDiscardCarry(new Uint8Array());
      discardRule = { kind: 'byte', delimiters };
      return new Uint8Array();
    }
    const delimiter = discardCarry.slice(delimiterIndex, delimiterIndex + 1);
    const remaining = discardCarry.slice(delimiterIndex + 1);
    replaceDiscardCarry(new Uint8Array());
    discardRule = undefined;
    return concatBytes(delimiter, feedNormal(remaining));
  };

  const feedDiscard = (chunk: Uint8Array): Uint8Array => {
    const rule = discardRule;
    if (rule === undefined) return feedNormal(chunk);
    const combined = concatBytes(discardCarry, chunk);
    replaceDiscardCarry(combined);
    if (rule.kind === 'byte') return discardUntilByteDelimiter(rule.delimiters, 0);
    if (rule.kind === 'byte-after-ows') {
      let valueStart = 0;
      while (valueStart < discardCarry.byteLength && isOws(discardCarry[valueStart] ?? 0))
        valueStart += 1;
      if (valueStart === discardCarry.byteLength) {
        replaceDiscardCarry(new Uint8Array());
        return new Uint8Array();
      }
      const firstValueByte = discardCarry[valueStart] ?? 0;
      if (rule.grammar === 'key-value' && (firstValueByte === 34 || firstValueByte === 39))
        return discardUntilByteDelimiter([firstValueByte], valueStart + 1);
      return discardUntilByteDelimiter(TOKEN_DELIMITERS, valueStart);
    }

    const delimiterIndex = indexOfSequence(discardCarry, rule.delimiter, 0);
    if (delimiterIndex < 0) {
      const retained = retainedDelimiterPrefix(discardCarry, rule.delimiter);
      replaceDiscardCarry(retained);
      return new Uint8Array();
    }
    const remaining = discardCarry.slice(delimiterIndex + rule.delimiter.byteLength);
    replaceDiscardCarry(new Uint8Array());
    discardRule = undefined;
    return feedNormal(remaining);
  };

  return Object.freeze({
    feed: (chunk: Uint8Array): Uint8Array => {
      assertActive();
      return feedDiscard(chunk);
    },
    flush: (): Uint8Array => {
      assertActive();
      if (discardRule !== undefined) {
        replaceDiscardCarry(new Uint8Array());
        discardRule = undefined;
        return new Uint8Array();
      }
      const processed = processCarry(carry, secretBytes, true);
      const output = processed.state === 'released' ? processed.output.slice() : new Uint8Array();
      replaceCarry(new Uint8Array());
      return output;
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      replaceCarry(new Uint8Array());
      replaceDiscardCarry(new Uint8Array());
      discardRule = undefined;
      for (const secret of secretBytes) secret.fill(0);
    },
  });
};
