import { processCarry } from './engine.js';
import {
  concatBytes,
  type DiscardRule,
  indexOfSequence,
  isOws,
  matchSequence,
  TOKEN_DELIMITERS,
} from './rules.js';

export interface RedactionChannel {
  feed(chunk: Uint8Array): Uint8Array;
  flush(): Uint8Array;
  dispose(): void;
}

const encoder = new TextEncoder();
const CARRY_LIMIT = 65_536;

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
      while (valueStart < discardCarry.byteLength && isOws(discardCarry[valueStart]!))
        valueStart += 1;
      if (valueStart === discardCarry.byteLength) {
        replaceDiscardCarry(new Uint8Array());
        return new Uint8Array();
      }
      const firstValueByte = discardCarry[valueStart]!;
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
      const output = processed.output.slice();
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
