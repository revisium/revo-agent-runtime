import { expect, test } from 'vitest';

import {
  finalizeInvocationOutcome,
  type NormalizedInvocationOutcome,
} from '../../../../src/runtime/execution/index.js';
import { FakeInvocationOutputPort } from '../../../support/execution/fake-output-port.js';

const candidate: NormalizedInvocationOutcome = Object.freeze({
  status: 'succeeded',
  value: Object.freeze({ result: Object.freeze({ ok: true }) }),
  evidence: Object.freeze({}),
});

test('records an immutable candidate once and retains it after a successful commit', async () => {
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording();

  await expect(finalizeInvocationOutcome(output, candidate)).resolves.toBe(candidate);
  expect(output.calls()).toEqual([{ type: 'record-terminal-result', outcome: candidate }]);
  expect(output.recordedTerminalResults()).toEqual([candidate]);
  expect(output.recordedTerminalResults()[0]).not.toBe(candidate);
});

test('replaces a rejected single output attempt without retrying or leaking the error', async () => {
  const output = new FakeInvocationOutputPort();
  output.enqueueTerminalResultRecording(new Error('output secret'));

  const outcome = await finalizeInvocationOutcome(output, candidate);

  expect(outcome).toEqual({
    status: 'failed',
    failure: { kind: 'finalization', code: 'revo.agent.output_write_failed' },
    evidence: {},
  });
  expect(output.calls()).toHaveLength(1);
  expect(output.recordedTerminalResults()).toEqual([]);
  expect(JSON.stringify(outcome)).not.toContain('output secret');
});
