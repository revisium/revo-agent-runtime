import { expect, test } from 'vitest';

import {
  BoundedRawResponseEvidence,
  createRawResponseCapture,
  createRedactionChannel,
  type ParserFailureReason,
} from '../../../../../src/runtime/execution/index.js';
import { CodexJsonlResultParser } from '../../../../../src/strategies/result-parser/codex/codex-jsonl-result-parser.js';

const encoder = new TextEncoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);
const line = (value: unknown): Uint8Array => bytes(`${JSON.stringify(value)}\n`);
const parser = (maxRawResponseBytes = 1_048_576): CodexJsonlResultParser =>
  new CodexJsonlResultParser(maxRawResponseBytes);

const agentMessage = (text: string): Uint8Array =>
  line({ type: 'item.completed', item: { type: 'agent_message', text } });
const terminal = (usage?: unknown): Uint8Array =>
  line({ type: 'turn.completed', ...(usage === undefined ? {} : { usage }) });
const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const expectWriteFailure = (
  input: Uint8Array,
  reason: ParserFailureReason,
  maxRawResponseBytes?: number,
): void => {
  const subject = parser(maxRawResponseBytes);
  expect(subject.writeProtocolBytes(input)).toEqual({ status: 'failed', reason });
  expect(subject.writeProtocolBytes(line({ type: 'future.info' }))).toEqual({
    status: 'failed',
    reason,
  });
  expect(subject.endProtocolBytes()).toEqual({ status: 'failed', reason });
};

const completedResponse = (subject: CodexJsonlResultParser) => {
  const result = subject.endProtocolBytes();
  expect(result.status).toBe('completed');
  if (result.status !== 'completed') throw new Error('expected parser completion');
  return result.response;
};

test('returns completed response and usage from multi-line Codex JSONL stream', () => {
  const subject = parser();
  const payload = bytes(
    `${JSON.stringify({ type: 'thread.started' })}\r\n` +
      `${JSON.stringify({ type: 'turn.started' })}\n` +
      `${JSON.stringify({ type: 'item.started' })}\n` +
      `${JSON.stringify({ type: 'future.info', payload: true })}\n` +
      `${JSON.stringify({ type: 'item.completed', item: { type: 'tool_call', text: '{}' } })}\n` +
      `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true,"nested":{"value":1}}' } })}\n` +
      `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 2 } })}\n`,
  );

  expect(subject.id).toBe('codex-jsonl/v1');
  expect(subject.writeProtocolBytes(payload.slice(0, 31))).toEqual({ status: 'observed' });
  expect(subject.writeProtocolBytes(payload.slice(31))).toEqual({ status: 'observed' });

  expect(subject.endProtocolBytes()).toEqual({
    status: 'completed',
    response: { ok: true, nested: { value: 1 } },
    usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2 },
  });
});

test('deep-freezes the completed JSON object response', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(agentMessage('{"nested":{"value":1}}'))).toEqual({
    status: 'observed',
  });
  expect(subject.writeProtocolBytes(terminal())).toEqual({ status: 'observed' });

  const response = completedResponse(subject);
  expect(Object.isFrozen(response)).toBe(true);
  expect(Object.isFrozen(response.nested)).toBe(true);
  try {
    if (
      typeof response.nested === 'object' &&
      response.nested !== null &&
      !Array.isArray(response.nested)
    ) {
      Object.assign(response.nested, { value: 2 });
    }
  } catch {
    // Strict-mode mutation attempts against frozen objects may throw; the observable value must not change.
  }
  expect(response).toEqual({ nested: { value: 1 } });
});

test('returns response_empty for an empty agent message payload', () => {
  expectWriteFailure(agentMessage(''), 'response_empty');
});

test('returns response_too_large for an oversized terminal response payload', () => {
  const subject = parser(64);
  expect(
    subject.writeProtocolBytes(
      agentMessage(
        '{"oversized":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
      ),
    ),
  ).toEqual({
    status: 'failed',
    reason: 'response_too_large',
  });
});

test('returns invalid_utf8 for a non-UTF-8 outer JSONL frame', () => {
  expectWriteFailure(new Uint8Array([0xff, 0x0a]), 'invalid_utf8');
});

test('returns invalid_json for a UTF-8 outer JSONL frame that is not JSON', () => {
  expectWriteFailure(bytes('{bad}\n'), 'invalid_json');
});

test('returns invalid_json for an agent message payload that is not JSON', () => {
  expectWriteFailure(agentMessage('{bad}'), 'invalid_json');
});

test('returns response_not_object for a JSON payload that is not a top-level object', () => {
  expectWriteFailure(agentMessage('[]'), 'response_not_object');
});

test('returns frame_malformed for an outer frame without a string type', () => {
  expectWriteFailure(line({ type: 123 }), 'frame_malformed');
});

test('returns frame_malformed for any non-terminal frame after terminal completion', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(terminal())).toEqual({ status: 'observed' });
  expect(subject.writeProtocolBytes(line({ type: 'thread.started' }))).toEqual({
    status: 'failed',
    reason: 'frame_malformed',
  });
});

test('returns frame_overflow when carry exceeds the effective parser byte bound', () => {
  expectWriteFailure(bytes('xxxxxxxxxxxxxxxxx'), 'frame_overflow', 16);
});

test('returns duplicate_terminal for a second terminal frame', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(terminal())).toEqual({ status: 'observed' });
  expect(subject.writeProtocolBytes(terminal())).toEqual({
    status: 'failed',
    reason: 'duplicate_terminal',
  });
});

test('returns missing_terminal when protocol input ends before a terminal frame', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(agentMessage('{"ok":true}'))).toEqual({ status: 'observed' });
  expect(subject.endProtocolBytes()).toEqual({ status: 'failed', reason: 'missing_terminal' });
});

test('returns missing_terminal for an error frame with no later terminal frame', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(line({ type: 'error', message: 'transient' }))).toEqual({
    status: 'observed',
  });
  expect(subject.endProtocolBytes()).toEqual({ status: 'failed', reason: 'missing_terminal' });
});

test('allows an error frame before a legitimate terminal frame', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(line({ type: 'error', message: 'transient' }))).toEqual({
    status: 'observed',
  });
  expect(subject.writeProtocolBytes(agentMessage('{"ok":true}'))).toEqual({ status: 'observed' });
  expect(subject.writeProtocolBytes(terminal())).toEqual({ status: 'observed' });
  expect(subject.endProtocolBytes()).toEqual({ status: 'completed', response: { ok: true } });
});

test('dispose clears the carry buffer without producing a terminal result', () => {
  const subject = parser();
  expect(subject.writeProtocolBytes(bytes('{"type":"turn.completed"'))).toEqual({
    status: 'observed',
  });
  subject.dispose();

  expect(subject.endProtocolBytes()).toEqual({ status: 'failed', reason: 'missing_terminal' });
});

const parserWithCapture = (maxRawResponseBytes = 1_048_576): CodexJsonlResultParser =>
  new CodexJsonlResultParser(
    maxRawResponseBytes,
    createRawResponseCapture({
      channel: createRedactionChannel([]),
      maxRawResponseBytes,
      previewBytes: 1_048_576,
    }),
  );

const takeResultRaw = (raw: BoundedRawResponseEvidence | undefined): string | undefined => {
  const taken = BoundedRawResponseEvidence.take(raw);
  return taken === undefined ? undefined : new TextDecoder().decode(taken);
};

test.each([
  ['response_empty', agentMessage('')],
  [
    'response_too_large',
    agentMessage(
      '{"oversized":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}',
    ),
    64,
  ],
  ['duplicate_terminal', concat(terminal(), terminal())],
  ['invalid_utf8', new Uint8Array([0xff, 0x0a])],
  ['invalid_json', bytes('{bad}\n')],
  ['response_not_object', agentMessage('[]')],
] satisfies readonly (readonly [ParserFailureReason, Uint8Array, number?])[])(
  'captures raw candidate bytes for %s parser failures',
  (reason, input, maxBytes?: number) => {
    const subject = parserWithCapture(maxBytes);
    const result = subject.writeProtocolBytes(typeof input === 'string' ? bytes(input) : input);

    expect(result).toMatchObject({ status: 'failed', reason });
    if (result.status !== 'failed') throw new Error('Expected parser failure.');
    expect(takeResultRaw(result.raw)).not.toBeUndefined();
  },
);

test('captures zero-byte raw evidence for missing terminal without previous candidate', () => {
  const subject = parserWithCapture();
  const result = subject.endProtocolBytes();

  expect(result).toMatchObject({ status: 'failed', reason: 'missing_terminal' });
  if (result.status !== 'failed') throw new Error('Expected parser failure.');
  expect(result.raw?.view).toEqual({
    byteLength: 0,
    retainedByteLength: 0,
    truncated: false,
    preview: '',
  });
});
