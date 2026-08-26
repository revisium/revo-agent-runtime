import { expect, test } from 'vitest';

import { TerminalSubscriptions } from '../../../../src/application/manager/subscriptions.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';

type TerminalInvocationEvent = Parameters<TerminalSubscriptions['deliver']>[0];
type SubscriptionAdmission = ReturnType<TerminalSubscriptions['subscribe']>;

const event = (invocationId: string): TerminalInvocationEvent => {
  return Object.freeze({
    schemaVersion: 'agent-event/v1',
    type: 'invocation.finished',
    invocationId,
    pin: Object.freeze({ agentId: 'agent', agentVersion: '1.0.0', definitionDigest: 'digest' }),
    sequence: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
  });
};

const expectSubscribed = (admission: SubscriptionAdmission): (() => void) => {
  return admission;
};

test('admits listeners without a package-owned capacity', () => {
  const subscriptions = new TerminalSubscriptions();
  const calls: string[] = [];
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('first')));
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('second')));
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('third')));
  subscriptions.deliver(event('first'));
  expect(calls).toEqual(['first', 'second', 'third']);
});

test('does not couple listener registration to completed retention capacity', () => {
  const subscriptions = new TerminalSubscriptions();

  const first = subscriptions.subscribe({}, () => undefined);
  const second = subscriptions.subscribe({}, () => undefined);

  expect(first).toEqual(expect.any(Function));
  expect(second).toEqual(expect.any(Function));
});

test('frees exactly one slot after idempotent disposal', () => {
  const subscriptions = new TerminalSubscriptions();
  const calls: string[] = [];
  const dispose = expectSubscribed(subscriptions.subscribe({}, () => calls.push('disposed')));
  dispose();
  dispose();
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('replacement')));

  subscriptions.deliver(event('first'));

  expect(calls).toEqual(['replacement']);
});

test('keeps snapshot delivery future-only when a reentrant admission frees a slot', () => {
  const subscriptions = new TerminalSubscriptions();
  const calls: string[] = [];
  let reentrantAdmission: SubscriptionAdmission | undefined;
  let disposeCurrent: () => void = () => undefined;
  disposeCurrent = expectSubscribed(
    subscriptions.subscribe({}, () => {
      calls.push('current');
      disposeCurrent();
      reentrantAdmission = subscriptions.subscribe({}, () => calls.push('late'));
    }),
  );

  subscriptions.deliver(event('first'));
  subscriptions.deliver(event('second'));

  expect(reentrantAdmission).toEqual(expect.any(Function));
  expect(calls).toEqual(['current', 'late']);
});

test('retains a throwing listener for future events while isolating the failure', () => {
  const subscriptions = new TerminalSubscriptions();
  const calls: string[] = [];
  let reentrantAdmission: SubscriptionAdmission | undefined;
  expectSubscribed(
    subscriptions.subscribe({}, () => {
      calls.push('throwing');
      reentrantAdmission = subscriptions.subscribe({}, () => calls.push('hidden'));
      throw new Error('listener failure');
    }),
  );
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('independent')));

  subscriptions.deliver(event('first'));
  const replacement = expectSubscribed(
    subscriptions.subscribe({}, () => calls.push('replacement')),
  );
  subscriptions.deliver(event('second'));
  replacement();

  expect(reentrantAdmission).toEqual(expect.any(Function));
  expect(calls).toEqual([
    'throwing',
    'independent',
    'throwing',
    'independent',
    'hidden',
    'replacement',
  ]);
});

test('counts repeated listener failures until explicit disposal', () => {
  const subscriptions = new TerminalSubscriptions();
  let recordingCalls = 0;
  const throwing = expectSubscribed(
    subscriptions.subscribe({}, () => {
      throw new Error('failure');
    }),
  );
  expectSubscribed(
    subscriptions.subscribe({}, () => {
      recordingCalls += 1;
    }),
  );

  subscriptions.deliver(event('first'));
  subscriptions.deliver(event('second'));
  subscriptions.deliver(event('third'));
  expect(recordingCalls).toBe(3);
  expect(subscriptions.isolatedFailureCount()).toBe(3);

  throwing();
  subscriptions.deliver(event('fourth'));
  expect(subscriptions.isolatedFailureCount()).toBe(3);
});

test('isolates one throwing listener from all other listeners in one delivery', () => {
  const subscriptions = new TerminalSubscriptions();
  const calls: string[] = [];
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('before')));
  expectSubscribed(
    subscriptions.subscribe({}, () => {
      throw new Error('failure');
    }),
  );
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('after')));

  subscriptions.deliver(event('single'));
  expect(calls).toEqual(['before', 'after']);
});

test('matches copied agent and event-type filters', () => {
  const subscriptions = new TerminalSubscriptions();
  const calls: string[] = [];
  const agent = { id: 'agent', version: '1.0.0' };
  const types: ('invocation.finished' | 'invocation.started')[] = ['invocation.finished'];
  subscriptions.subscribe({ agent, types }, () => calls.push('matched'));
  agent.id = 'changed';
  types.push('invocation.started');
  subscriptions.deliver(event('filtered'));
  expect(calls).toEqual(['matched']);
});

test.each([
  { filter: { types: 'invocation.finished' }, message: 'types' },
  { filter: { types: ['unknown'] }, message: 'types' },
  { filter: { agent: { id: 'agent' } }, message: 'agent' },
  { filter: { unsupported: true }, message: 'unsupported' },
])('rejects malformed $message filters', ({ filter }) => {
  const subscriptions = new TerminalSubscriptions();
  expect(() => subscriptions.subscribe(filter, () => undefined)).toThrowError(AgentManagerError);
});

test('copies matching filters and honors cross disposal during a snapshot', () => {
  const subscriptions = new TerminalSubscriptions();
  const filter = { invocationId: 'first' };
  const calls: string[] = [];
  expectSubscribed(
    subscriptions.subscribe(filter, (received) => calls.push(received.invocationId)),
  );
  filter.invocationId = 'second';
  let disposeNext: () => void = () => undefined;
  expectSubscribed(
    subscriptions.subscribe({}, () => {
      calls.push('disposer');
      disposeNext();
    }),
  );
  disposeNext = expectSubscribed(subscriptions.subscribe({}, () => calls.push('next')));

  subscriptions.deliver(event('first'));
  subscriptions.deliver(event('second'));

  expect(calls).toEqual(['first', 'disposer', 'disposer']);
});
