import { expect, test } from 'vitest';

import type { NormalizedInvocationOutcome } from '../../../../src/runtime/execution/index.js';
import {
  FakeInvocationOutputPort,
  type InvocationOutputCall,
} from '../../../support/execution/fake-output-port.js';

const outcome: NormalizedInvocationOutcome = Object.freeze({
  status: 'succeeded',
  value: Object.freeze({ accepted: true }),
  evidence: Object.freeze({}),
});

test('runs independently scripted logical output recording operations in FIFO order', async () => {
  const output = new FakeInvocationOutputPort();
  const terminalFailure = new Error('terminal failed');
  const eventFailure = new Error('event failed');

  output.enqueueTerminalResultRecording(terminalFailure);
  output.enqueueTerminalResultRecording();
  output.enqueueEventRecording(eventFailure);
  output.enqueueEventRecording();

  await expect(output.recordTerminalResult(outcome)).rejects.toBe(terminalFailure);
  await expect(output.recordTerminalResult(outcome)).resolves.toBeUndefined();
  await expect(output.recordEvent()).rejects.toBe(eventFailure);
  await expect(output.recordEvent()).resolves.toBeUndefined();

  expect(output.calls()).toEqual([
    { type: 'record-terminal-result', outcome },
    { type: 'record-terminal-result', outcome },
    { type: 'record-event' },
    { type: 'record-event' },
  ] satisfies readonly InvocationOutputCall[]);
});

test('returns frozen copied call logs and fails loudly without an outcome', async () => {
  const output = new FakeInvocationOutputPort();

  output.enqueueEventRecording();
  await output.recordEvent();
  const calls = output.calls();

  expect(Object.isFrozen(calls)).toBe(true);
  expect(Object.isFrozen(calls[0])).toBe(true);
  expect(calls).toEqual([{ type: 'record-event' }] satisfies readonly InvocationOutputCall[]);
  await expect(output.recordTerminalResult(outcome)).rejects.toThrow(
    'No terminal-result recording outcome is queued',
  );
  await expect(output.recordEvent()).rejects.toThrow('No event recording outcome is queued');
});

test('performs no setup or side effect until a logical operation is called', () => {
  const output = new FakeInvocationOutputPort();

  output.enqueueTerminalResultRecording();
  output.enqueueEventRecording();

  expect(output.calls()).toEqual([]);
});

test('records a detached frozen candidate before resolving a pending terminal commit', async () => {
  const output = new FakeInvocationOutputPort();
  output.enqueuePendingTerminalResultRecording();
  const pending = output.recordTerminalResult(outcome);

  expect(output.calls()).toEqual([{ type: 'record-terminal-result', outcome }]);
  expect(output.recordedTerminalResults()).toEqual([]);
  output.fulfilPendingTerminalResultRecording(1);
  await pending;

  const recorded = output.recordedTerminalResults();
  expect(recorded).toEqual([outcome]);
  expect(Object.isFrozen(recorded[0])).toBe(true);
  expect(Object.isFrozen(recorded[0]?.status === 'succeeded' ? recorded[0].value : undefined)).toBe(
    true,
  );
});
