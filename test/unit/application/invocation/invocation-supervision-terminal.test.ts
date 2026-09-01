import { afterEach, expect, test, vi } from 'vitest';

import { controlledSupervision, remainsPending } from '../../../support/assertions/supervision.js';
import {
  fixtureLaunchEvidence,
  fixtureProcessExit,
} from '../../../support/builders/execution-evidence.js';

afterEach(() => vi.useRealTimers());
test('first protocol terminal wins over later cancel and process exit candidates', async () => {
  const scenario = controlledSupervision();
  expect(scenario.execution.output?.()).toEqual({
    stderr: new Uint8Array(),
    stdout: new Uint8Array(),
  });
  await scenario.accept();

  await scenario.agentCompletes({ answer: 'first terminal' });
  await Promise.resolve();
  scenario.execution.cancel();
  scenario.processExits();

  await expect(scenario.execution.completion).resolves.toEqual({
    status: 'succeeded',
    value: { answer: 'first terminal' },
  });
  expect(scenario.cleanupCalls()).toBe(1);
});

test('rejects an otherwise valid definition before spawn when its argument strategy is unsupported', async () => {
  const scenario = controlledSupervision({ launchArgs: [{ kind: 'workspace' }] });

  await expect(scenario.execution.admission).resolves.toEqual({
    cleanup: 'confirmed',
    outcome: { status: 'failed' },
    status: 'rejected',
  });
  await expect(scenario.execution.completion).resolves.toEqual({ status: 'failed' });
  expect(scenario.processStartCalls()).toBe(0);
});

test('contains an ordinary process spawn rejection as a confirmed failed admission', async () => {
  const scenario = controlledSupervision({ processStart: 'reject' });

  await expect(scenario.execution.admission).resolves.toEqual({
    cleanup: 'confirmed',
    outcome: { status: 'failed' },
    status: 'rejected',
  });
  await expect(scenario.execution.drainage).resolves.toEqual({
    outcome: { status: 'failed' },
    status: 'terminal',
  });
});

test('retains bounded stdout and stderr emitted by the owned process until confirmed cleanup', async () => {
  const scenario = controlledSupervision();
  await scenario.accept();
  scenario.writeProcessOutput({ stderr: 'warning', stdout: 'answer' });

  await scenario.agentCompletes({ answer: 'terminal' });
  await scenario.execution.completion;

  expect(scenario.execution.output?.()).toEqual({
    stderr: new TextEncoder().encode('warning'),
    stdout: new TextEncoder().encode('answer'),
  });
});

test('failed provider cancellation cannot prevent authoritative cleanup', async () => {
  const scenario = controlledSupervision({ providerCancel: 'reject' });
  await scenario.accept();

  scenario.execution.cancel();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
  expect(scenario.providerCancelCalls()).toBe(1);
  expect(scenario.cleanupCalls()).toBe(1);
});

test('synchronous provider cancel and close failures cannot bypass authoritative cleanup', async () => {
  const scenario = controlledSupervision({ providerCancel: 'throw', providerClose: 'throw' });
  await scenario.accept();

  scenario.execution.cancel();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
  expect(scenario.providerCancelCalls()).toBe(1);
  expect(scenario.providerCloseCalls()).toBe(1);
  expect(scenario.cleanupCalls()).toBe(1);
});

test('local cancellation reaches cleanup while the protocol handshake is still pending', async () => {
  const scenario = controlledSupervision({ protocolOpen: 'pending' });
  await scenario.accept();

  scenario.execution.cancel();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
  expect(scenario.cleanupCalls()).toBe(1);
});

test('wall deadline commits once and local cleanup follows', async () => {
  vi.useFakeTimers();
  const scenario = controlledSupervision({ wallClockTimeoutMs: 1_000 });
  await scenario.accept();

  await vi.advanceTimersByTimeAsync(1_000);

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'timed_out' });
  expect(scenario.events).toEqual(['started', 'cancelling']);
});

test('idle deadline resets only when the protocol reports validated activity', async () => {
  vi.useFakeTimers();
  const scenario = controlledSupervision({ idleTimeoutMs: 1_000 });
  await scenario.accept();

  await vi.advanceTimersByTimeAsync(750);
  await scenario.validActivity();
  await vi.advanceTimersByTimeAsync(750);
  expect(await remainsPending(scenario.execution.completion)).toBe(true);
  await vi.advanceTimersByTimeAsync(250);

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'timed_out' });
});

test('natural process exit without a protocol terminal is a failed terminal candidate', async () => {
  const scenario = controlledSupervision();
  await scenario.accept();

  scenario.processExits();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'failed' });
});

test('unconfirmed cleanup exposes drainage failure and never publishes a terminal outcome', async () => {
  const scenario = controlledSupervision({ cleanup: 'uncertain' });
  await scenario.accept();

  scenario.execution.cancel();

  await expect(scenario.execution.drainage).resolves.toEqual({ status: 'cleanup_uncertain' });
  expect(await remainsPending(scenario.execution.completion)).toBe(true);
});

test('provider session failure becomes a failed terminal before local cleanup', async () => {
  const scenario = controlledSupervision();
  await scenario.accept();

  await scenario.agentConnectionFails();

  await expect(scenario.execution.completion).resolves.toEqual({ status: 'failed' });
  expect(scenario.cleanupCalls()).toBe(1);
});

test('unexpected cleanup failure stays failed closed with an uncertain drainage state', async () => {
  const scenario = controlledSupervision({ cleanup: 'throw' });
  await scenario.accept();

  scenario.execution.cancel();

  await expect(scenario.execution.drainage).resolves.toEqual({ status: 'cleanup_uncertain' });
  expect(await remainsPending(scenario.execution.completion)).toBe(true);
});

test('preacceptance cancellation with uncertain cleanup never becomes publicly admissible', async () => {
  const scenario = controlledSupervision({ cleanup: 'uncertain' });

  scenario.execution.cancel();

  await expect(scenario.execution.admission).resolves.toEqual({
    cleanup: 'uncertain',
    outcome: { status: 'cancelled' },
    status: 'rejected',
  });
  await expect(scenario.execution.drainage).resolves.toEqual({ status: 'cleanup_uncertain' });
  expect(await remainsPending(scenario.execution.completion)).toBe(true);
});

test('preacceptance cancellation resolves when cleanup is confirmed', async () => {
  const scenario = controlledSupervision();

  scenario.execution.cancel();

  await expect(scenario.execution.admission).resolves.toEqual({
    cleanup: 'confirmed',
    evidence: {
      launch: fixtureLaunchEvidence,
      processExit: fixtureProcessExit(),
    },
    outcome: { status: 'cancelled' },
    status: 'rejected',
  });
  await expect(scenario.execution.completion).resolves.toEqual({ status: 'cancelled' });
});
