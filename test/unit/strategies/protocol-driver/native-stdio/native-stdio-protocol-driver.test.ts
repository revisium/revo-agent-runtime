import { expect, test, vi } from 'vitest';

import type {
  ProcessInputSink,
  ProtocolDriverCreateRequest,
  ResultParserPort,
  ResultParserWriteResult,
} from '../../../../../src/runtime/execution/index.js';
import { NativeStdioProtocolDriver } from '../../../../../src/strategies/protocol-driver/native-stdio/native-stdio-protocol-driver.js';
import { CodexJsonlResultParser } from '../../../../../src/strategies/result-parser/codex/codex-jsonl-result-parser.js';

const encoder = new TextEncoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);
const line = (value: unknown): Uint8Array => bytes(`${JSON.stringify(value)}\n`);

const delivery = (prompt: 'argument' | 'stdin' | 'file'): ProtocolDriverCreateRequest['delivery'] =>
  Object.freeze({ prompt, resultSchema: 'argument', result: 'stdout' });

const inputSink = (
  overrides: Partial<ProcessInputSink> = {},
): ProcessInputSink & {
  readonly written: Uint8Array[];
} => {
  const written: Uint8Array[] = [];
  return Object.freeze({
    written,
    write:
      overrides.write ?? (async (chunk: Uint8Array): Promise<void> => void written.push(chunk)),
    end: overrides.end ?? (async (): Promise<void> => undefined),
    abort: overrides.abort ?? (async (): Promise<void> => undefined),
  });
};

const parser = (): CodexJsonlResultParser => new CodexJsonlResultParser(1_048_576);

const request = (
  overrides: Partial<ProtocolDriverCreateRequest> = {},
): ProtocolDriverCreateRequest =>
  Object.freeze({
    invocationId: 'driver-test',
    delivery: delivery('argument'),
    cancellationSupported: false,
    resultParser: parser(),
    ...overrides,
  });

class FakeParser implements ResultParserPort {
  readonly id = 'codex-jsonl/v1';
  readonly writeProtocolBytes = vi.fn(
    (_bytes: Uint8Array): ResultParserWriteResult => ({
      status: 'observed',
    }),
  );
  readonly endProtocolBytes = vi.fn<ResultParserPort['endProtocolBytes']>(() => ({
    status: 'failed',
    reason: 'missing_terminal',
  }));
  readonly dispose = vi.fn<ResultParserPort['dispose']>();
}

test('stdin delivery writes exact prompt bytes then ends input', async () => {
  const promptBytes = bytes('hello prompt');
  const end = vi.fn(async (): Promise<void> => undefined);
  const input = inputSink({ end });
  const prepared = new NativeStdioProtocolDriver().create(
    request({ delivery: delivery('stdin'), promptBytes }),
  );

  await expect(prepared.attach(input)).resolves.toMatchObject({ status: 'attached' });

  expect(input.written).toEqual([promptBytes]);
  expect(end).toHaveBeenCalledTimes(1);
});

test('argument and file delivery end input without writing prompt bytes', async () => {
  const argumentEnd = vi.fn(async (): Promise<void> => undefined);
  const argumentInput = inputSink({ end: argumentEnd });
  await expect(
    new NativeStdioProtocolDriver()
      .create(request({ delivery: delivery('argument'), promptBytes: bytes('unused') }))
      .attach(argumentInput),
  ).resolves.toMatchObject({ status: 'attached' });
  expect(argumentInput.written).toEqual([]);
  expect(argumentEnd).toHaveBeenCalledTimes(1);

  const fileEnd = vi.fn(async (): Promise<void> => undefined);
  const fileInput = inputSink({ end: fileEnd });
  await expect(
    new NativeStdioProtocolDriver()
      .create(request({ delivery: delivery('file'), promptBytes: bytes('unused') }))
      .attach(fileInput),
  ).resolves.toMatchObject({ status: 'attached' });
  expect(fileInput.written).toEqual([]);
  expect(fileEnd).toHaveBeenCalledTimes(1);
});

test('stdin delivery without prompt bytes fails attach without throwing or touching input', async () => {
  const write = vi.fn(async (): Promise<void> => undefined);
  const end = vi.fn(async (): Promise<void> => undefined);
  const input = inputSink({ write, end });
  const prepared = new NativeStdioProtocolDriver().create(request({ delivery: delivery('stdin') }));

  await expect(prepared.attach(input)).resolves.toEqual({
    status: 'failed',
    reason: 'attach_failed',
  });

  expect(write).not.toHaveBeenCalled();
  expect(end).not.toHaveBeenCalled();
});

test('maps stdin write and end rejections to attach failure reasons', async () => {
  const promptBytes = bytes('hello prompt');
  const writeRejectEnd = vi.fn(async (): Promise<void> => undefined);
  const writeRejected = inputSink({
    write: vi.fn(async (): Promise<void> => {
      throw new Error('write failed');
    }),
    end: writeRejectEnd,
  });
  const endRejected = inputSink({
    end: vi.fn(async (): Promise<void> => {
      throw new Error('end failed');
    }),
  });

  await expect(
    new NativeStdioProtocolDriver()
      .create(request({ delivery: delivery('stdin'), promptBytes }))
      .attach(writeRejected),
  ).resolves.toEqual({ status: 'failed', reason: 'stdin_write_failed' });
  expect(writeRejectEnd).not.toHaveBeenCalled();

  await expect(
    new NativeStdioProtocolDriver()
      .create(request({ delivery: delivery('argument') }))
      .attach(endRejected),
  ).resolves.toEqual({ status: 'failed', reason: 'stdin_end_failed' });
});

test('completes stdout parser observation after multiple protocol output writes', async () => {
  const prepared = new NativeStdioProtocolDriver().create(request());
  const attachResult = await prepared.attach(inputSink());
  if (attachResult.status !== 'attached') throw new Error('expected attached session');

  await expect(
    prepared.protocolOutput.write(
      line({ type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } }),
    ),
  ).resolves.toBeUndefined();
  await expect(
    prepared.protocolOutput.write(
      line({
        type: 'turn.completed',
        usage: { input_tokens: 3, cached_input_tokens: 1, output_tokens: 2 },
      }),
    ),
  ).resolves.toBeUndefined();

  await expect(attachResult.session.finishAfterProtocolOutputEnd()).resolves.toEqual({
    status: 'completed',
    response: { ok: true },
    usage: { inputTokens: 3, cachedInputTokens: 1, outputTokens: 2 },
  });
});

test('rejects protocol output writes on parser failure and finishes with stored failure', async () => {
  const fakeParser = new FakeParser();
  fakeParser.writeProtocolBytes.mockReturnValueOnce({ status: 'failed', reason: 'invalid_json' });
  const prepared = new NativeStdioProtocolDriver().create(request({ resultParser: fakeParser }));
  const attachResult = await prepared.attach(inputSink());
  if (attachResult.status !== 'attached') throw new Error('expected attached session');

  await expect(prepared.protocolOutput.write(bytes('{bad}\n'))).rejects.toThrow('invalid_json');
  await expect(attachResult.session.finishAfterProtocolOutputEnd()).resolves.toEqual({
    status: 'failed',
    failure: { kind: 'parser_failed', reason: 'invalid_json' },
  });

  expect(fakeParser.endProtocolBytes).not.toHaveBeenCalled();
});

test('maps parser end failure to parser_failed observation', async () => {
  const fakeParser = new FakeParser();
  fakeParser.endProtocolBytes.mockReturnValue({ status: 'failed', reason: 'missing_terminal' });
  const prepared = new NativeStdioProtocolDriver().create(request({ resultParser: fakeParser }));
  const attachResult = await prepared.attach(inputSink());
  if (attachResult.status !== 'attached') throw new Error('expected attached session');

  await expect(attachResult.session.finishAfterProtocolOutputEnd()).resolves.toEqual({
    status: 'failed',
    failure: { kind: 'parser_failed', reason: 'missing_terminal' },
  });
});

test('requestCancellation is unsupported and closeInput calls input end again', async () => {
  const end = vi.fn(async (): Promise<void> => undefined);
  const input = inputSink({ end });
  const prepared = new NativeStdioProtocolDriver().create(request());
  const attachResult = await prepared.attach(input);
  if (attachResult.status !== 'attached') throw new Error('expected attached session');

  await expect(attachResult.session.requestCancellation()).resolves.toBe('unsupported');
  await attachResult.session.closeInput();

  expect(end).toHaveBeenCalledTimes(2);
});

test('dispose delegates to the result parser', () => {
  const fakeParser = new FakeParser();
  const prepared = new NativeStdioProtocolDriver().create(request({ resultParser: fakeParser }));

  prepared.dispose();

  expect(fakeParser.dispose).toHaveBeenCalledTimes(1);
});

test('attached session dispose delegates to the result parser', async () => {
  const fakeParser = new FakeParser();
  const prepared = new NativeStdioProtocolDriver().create(request({ resultParser: fakeParser }));
  const attachResult = await prepared.attach(inputSink());
  if (attachResult.status !== 'attached') throw new Error('expected attached session');

  attachResult.session.dispose();

  expect(fakeParser.dispose).toHaveBeenCalledTimes(1);
});

test('create throws when the stdout result parser is missing', () => {
  const missingParserRequest: ProtocolDriverCreateRequest = Object.freeze({
    invocationId: 'driver-test',
    delivery: delivery('argument'),
    cancellationSupported: false,
  });

  expect(() => new NativeStdioProtocolDriver().create(missingParserRequest)).toThrow(
    'resultParser',
  );
});
