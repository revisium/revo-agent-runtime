import { expect, test } from 'vitest';

import { TerminalSubscriptions } from '../../../../src/application/manager/subscriptions.js';

type TerminalInvocationEvent = Parameters<TerminalSubscriptions['deliver']>[0];
type SubscriptionAdmission = ReturnType<TerminalSubscriptions['subscribe']>;

const event = (invocationId: string): TerminalInvocationEvent => {
  return Object.freeze({ type: 'invocation.finished', invocationId });
};

const expectSubscribed = (admission: SubscriptionAdmission): (() => void) => {
  if (admission.state !== 'subscribed') throw new Error('Expected subscription admission.');
  return admission.dispose;
};

test('admits exactly N listeners and rejects N plus one before it can receive an event', () => {
  const subscriptions = new TerminalSubscriptions(2);
  const calls: string[] = [];
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('first')));
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('second')));
  const rejected = subscriptions.subscribe({}, () => calls.push('rejected'));

  expect(rejected).toEqual({ state: 'rejected', reason: 'capacity' });
  subscriptions.deliver(event('first'));
  expect(calls).toEqual(['first', 'second']);
});

test('frees exactly one slot after idempotent disposal', () => {
  const subscriptions = new TerminalSubscriptions(1);
  const calls: string[] = [];
  const dispose = expectSubscribed(subscriptions.subscribe({}, () => calls.push('disposed')));
  dispose();
  dispose();
  expectSubscribed(subscriptions.subscribe({}, () => calls.push('replacement')));

  subscriptions.deliver(event('first'));

  expect(calls).toEqual(['replacement']);
});

test('keeps snapshot delivery future-only when a reentrant admission frees a slot', () => {
  const subscriptions = new TerminalSubscriptions(1);
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

  expect(reentrantAdmission).toEqual(expect.objectContaining({ state: 'subscribed' }));
  expect(calls).toEqual(['current', 'late']);
});

test('rejects a full reentrant admission and frees a throwing listener slot for a replacement', () => {
  const subscriptions = new TerminalSubscriptions(2);
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

  expect(reentrantAdmission).toEqual({ state: 'rejected', reason: 'capacity' });
  expect(calls).toEqual(['throwing', 'independent', 'independent', 'replacement']);
});

test('copies matching filters and honors cross disposal during a snapshot', () => {
  const subscriptions = new TerminalSubscriptions(3);
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
