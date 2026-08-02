import { expect, test } from 'vitest';

import { CodexJsonlResultParser } from '../../../../../src/strategies/result-parser/codex/codex-jsonl-result-parser.js';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test('parses a chunk-split CRLF JSONL completion with usage', () => {
  const parser = new CodexJsonlResultParser();
  const payload =
    '{"type":"thread.started"}\r\n{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}\r\n{"type":"turn.completed","usage":{"input_tokens":3,"cached_input_tokens":1,"output_tokens":2}}\r\n';
  const encoded = bytes(payload);
  parser.write(encoded.slice(0, 17));
  parser.write(encoded.slice(17));

  expect(parser.end()).toEqual({
    response: { ok: true },
    usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2 },
  });
});

test('rejects incomplete, unknown, invalid and failed streams', () => {
  expect(() => new CodexJsonlResultParser().end()).toThrow('no completed agent response');
  expect(() => new CodexJsonlResultParser().write(bytes('{"type":"unknown"}\n'))).toThrow(
    'Unknown Codex JSONL event',
  );
  expect(() => new CodexJsonlResultParser().write(bytes('{bad}\n'))).toThrow(
    'not valid UTF-8 JSON',
  );
  const errorParser = new CodexJsonlResultParser();
  expect(() => errorParser.write(bytes('{"type":"error"}\n'))).toThrow('reported an error');
  expect(() => errorParser.write(bytes('{"type":"turn.completed"}\n'))).toThrow(
    'reported an error',
  );
});

test('rejects malformed final messages, duplicate completion and nonzero exit', () => {
  const malformed = new CodexJsonlResultParser();
  expect(() =>
    malformed.write(
      bytes('{"type":"item.completed","item":{"type":"agent_message","text":"[]"}}\n'),
    ),
  ).toThrow('JSON object');
  let duplicate = new CodexJsonlResultParser();
  duplicate.write(bytes('{"type":"turn.completed"}\n'));
  expect(() => duplicate.write(bytes('{"type":"turn.completed"}\n'))).toThrow(
    'after turn.completed',
  );
  duplicate = new CodexJsonlResultParser();
  expect(() => duplicate.observeProcessExit(1, null)).toThrow('process failed');
  expect(() => duplicate.observeProcessExit(0, 'SIGTERM')).toThrow('process failed');
});
