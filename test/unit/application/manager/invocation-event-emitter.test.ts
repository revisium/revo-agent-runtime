import { expect, test } from 'vitest';

import { InvocationEventEmitter } from '../../../../src/application/manager/invocation-event-emitter.js';
import { TerminalSubscriptions } from '../../../../src/application/manager/subscriptions.js';
import type {
  OutputAppendResult,
  TerminalPublicationPort,
} from '../../../../src/runtime/execution/index.js';
import { TerminalPublicationAuthority } from '../../../../src/runtime/execution/output-preparation-attempt/terminal-publication-authority.js';
import type { AgentEvent, AgentExecutionPin } from '../../../../src/runtime/spec/index.js';

const pin: AgentExecutionPin = Object.freeze({
  agentId: 'codex',
  agentVersion: '1.0.0',
  definitionDigest: 'sha256:abc',
});

const authority = TerminalPublicationAuthority.create({
  invocationId: 'invocation-1',
  outputDirectory: '/outputs/invocation-1',
  invocationToken: Object.freeze({}),
});

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) throw new Error('Unable to create deferred.');
  return { promise, resolve };
};

class FakeTerminalPublicationPort implements TerminalPublicationPort {
  readonly appended: AgentEvent[] = [];
  private readonly queue: (OutputAppendResult | 'reject' | 'pending')[] = [];
  private readonly pending: Deferred<OutputAppendResult>[] = [];

  enqueue(result: OutputAppendResult | 'reject' | 'pending'): void {
    this.queue.push(result);
  }

  settlePending(index: number, result: OutputAppendResult = { status: 'appended' }): void {
    const held = this.pending[index];
    if (held === undefined) throw new Error(`No pending append at index ${index}`);
    held.resolve(result);
  }

  async appendLifecycleEvent(
    _authority: TerminalPublicationAuthority,
    event: AgentEvent,
  ): Promise<OutputAppendResult> {
    this.appended.push(event);
    const next = this.queue.shift();
    if (next === undefined) return Object.freeze({ status: 'appended' });
    if (next === 'reject') throw new Error('append failed synchronously');
    if (next === 'pending') {
      const held = deferred<OutputAppendResult>();
      this.pending.push(held);
      return held.promise;
    }
    return next;
  }

  async publishTerminalResult(): Promise<never> {
    throw new Error('publishTerminalResult is not exercised by InvocationEventEmitter tests');
  }

  async publishRawResponse(): Promise<never> {
    throw new Error('publishRawResponse is not exercised by InvocationEventEmitter tests');
  }

  async cleanupScratch(): Promise<never> {
    throw new Error('cleanupScratch is not exercised by InvocationEventEmitter tests');
  }
}

const createEmitter = (
  output: TerminalPublicationPort,
): { emitter: InvocationEventEmitter; delivered: AgentEvent[] } => {
  const subscriptions = new TerminalSubscriptions();
  const delivered: AgentEvent[] = [];
  subscriptions.subscribe({}, (event) => delivered.push(event));
  const emitter = new InvocationEventEmitter('invocation-1', pin, subscriptions, output, authority);
  return { emitter, delivered };
};

test('an appended nonterminal event does not fail pending evidence', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue(Object.freeze({ status: 'appended' }));
  const { emitter } = createEmitter(output);

  emitter.emit('invocation.accepted');

  await expect(emitter.settlePendingEvidence()).resolves.toBe(false);
});

test('a suppressed nonterminal event does not fail pending evidence', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue(Object.freeze({ status: 'suppressed', reason: 'nonterminal_budget_exhausted' }));
  const { emitter } = createEmitter(output);

  emitter.emit('invocation.accepted');

  await expect(emitter.settlePendingEvidence()).resolves.toBe(false);
});

test('a failed nonterminal append fails pending evidence', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue(Object.freeze({ status: 'failed', reason: 'write_failed' }));
  const { emitter } = createEmitter(output);

  emitter.emit('invocation.accepted');

  await expect(emitter.settlePendingEvidence()).resolves.toBe(true);
});

test('a synchronously rejecting append fails pending evidence', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue('reject');
  const { emitter } = createEmitter(output);

  emitter.emit('invocation.accepted');

  await expect(emitter.settlePendingEvidence()).resolves.toBe(true);
});

test('one failed append among several keeps pending evidence failed', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue(Object.freeze({ status: 'appended' }));
  output.enqueue(Object.freeze({ status: 'failed', reason: 'flush_failed' }));
  output.enqueue(Object.freeze({ status: 'suppressed', reason: 'nonterminal_budget_exhausted' }));
  const { emitter } = createEmitter(output);

  emitter.emit('invocation.accepted');
  emitter.emit('invocation.started');
  emitter.emit('invocation.cancelling');

  await expect(emitter.settlePendingEvidence()).resolves.toBe(true);
});

test('emit delivers synchronously to subscribers without waiting for the append to settle', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue('pending');
  const { emitter, delivered } = createEmitter(output);

  emitter.emit('invocation.accepted');

  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.type).toBe('invocation.accepted');

  await Promise.resolve();
  output.settlePending(0);
  await expect(emitter.settlePendingEvidence()).resolves.toBe(false);
});

test('the terminal event is appended before it is delivered', async () => {
  const output = new FakeTerminalPublicationPort();
  const { emitter, delivered } = createEmitter(output);

  output.enqueue('pending');
  const terminal = emitter.emitTerminal('2026-08-27T00:00:00.000Z');
  await Promise.resolve();
  expect(delivered).toEqual([]);
  expect(output.appended.map((event) => event.type)).toEqual(['invocation.finished']);
  output.settlePending(0);
  await terminal;

  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.type).toBe('invocation.finished');
  await expect(emitter.settlePendingEvidence()).resolves.toBe(false);
});

test.each([
  Object.freeze({ status: 'appended' as const }),
  Object.freeze({ status: 'suppressed' as const, reason: 'nonterminal_budget_exhausted' as const }),
  Object.freeze({ status: 'failed' as const, reason: 'write_failed' as const }),
  'reject' as const,
])('ignores terminal append outcome %s', async (outcome) => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue(outcome === 'reject' ? 'reject' : outcome);
  const { emitter, delivered } = createEmitter(output);

  await expect(emitter.emitTerminal()).resolves.toBeUndefined();
  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.type).toBe('invocation.finished');
});

test('sequence increments once per event regardless of append outcome', async () => {
  const output = new FakeTerminalPublicationPort();
  output.enqueue(Object.freeze({ status: 'failed', reason: 'write_failed' }));
  const { emitter, delivered } = createEmitter(output);

  emitter.emit('invocation.accepted');
  emitter.emit('invocation.started');
  await emitter.emitTerminal();

  expect(delivered.map((event) => event.sequence)).toEqual([1, 2, 3]);
});
