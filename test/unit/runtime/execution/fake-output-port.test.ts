import { expect, test } from 'vitest';

import {
  FakeInvocationOutputPort,
  type InvocationOutputCall,
} from '../../../support/execution/fake-output-port.js';

test('runs independently scripted logical output operations in FIFO order', async () => {
  const output = new FakeInvocationOutputPort();
  const prepareFailure = new Error('prepare failed');
  const terminalFailure = new Error('terminal failed');
  const eventFailure = new Error('event failed');

  output.enqueuePrepare(prepareFailure);
  output.enqueuePrepare();
  output.enqueueTerminalResultRecording(terminalFailure);
  output.enqueueTerminalResultRecording();
  output.enqueueEventRecording(eventFailure);
  output.enqueueEventRecording();

  await expect(output.prepare()).rejects.toBe(prepareFailure);
  await expect(output.prepare()).resolves.toBeUndefined();
  await expect(output.recordTerminalResult()).rejects.toBe(terminalFailure);
  await expect(output.recordTerminalResult()).resolves.toBeUndefined();
  await expect(output.recordEvent()).rejects.toBe(eventFailure);
  await expect(output.recordEvent()).resolves.toBeUndefined();

  expect(output.calls()).toEqual([
    { type: 'prepare' },
    { type: 'prepare' },
    { type: 'record-terminal-result' },
    { type: 'record-terminal-result' },
    { type: 'record-event' },
    { type: 'record-event' },
  ] satisfies readonly InvocationOutputCall[]);
});

test('returns frozen copied call logs and fails loudly without an outcome', async () => {
  const output = new FakeInvocationOutputPort();

  output.enqueuePrepare();
  await output.prepare();
  const calls = output.calls();

  expect(Object.isFrozen(calls)).toBe(true);
  expect(Object.isFrozen(calls[0])).toBe(true);
  expect(calls).toEqual([{ type: 'prepare' }] satisfies readonly InvocationOutputCall[]);
  await expect(output.prepare()).rejects.toThrow('No prepare outcome is queued');
  await expect(output.recordTerminalResult()).rejects.toThrow(
    'No terminal-result recording outcome is queued',
  );
  await expect(output.recordEvent()).rejects.toThrow('No event recording outcome is queued');
});

test('performs no setup or side effect until a logical operation is called', () => {
  const output = new FakeInvocationOutputPort();

  output.enqueuePrepare();
  output.enqueueTerminalResultRecording();
  output.enqueueEventRecording();

  expect(output.calls()).toEqual([]);
});
