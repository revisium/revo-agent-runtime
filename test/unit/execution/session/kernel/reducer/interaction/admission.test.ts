import { expect, test } from 'vitest';

import type { AgentSessionInteractiveRequest } from '../../../../../../../src/contracts/session/interaction/request.js';
import type { SessionState } from '../../../../../../../src/execution/session/kernel/model/session-state.js';
import { reduceSession } from '../../../../../../../src/execution/session/kernel/reducer/reduce.js';
import { streamingSessionState } from '../../../../../../support/session/builders/kernel/running.js';

const observed = { observedAt: '2026-03-21T00:00:02.000Z', observedAtMs: 2_000 } as const;
type PermissionRequest = Extract<AgentSessionInteractiveRequest, { readonly kind: 'permission' }>;

const permission = (requestId: string): PermissionRequest => ({
  action: { kind: 'execute', title: 'Run command' },
  kind: 'permission',
  options: [
    { kind: 'allow_once', label: 'Allow', optionId: 'allow' },
    { kind: 'reject_once', label: 'Reject', optionId: 'reject' },
  ],
  requestId,
});

const request = (state: SessionState, interactiveRequest: AgentSessionInteractiveRequest) => {
  if (
    state.status !== 'running' ||
    state.turn.status === 'starting' ||
    state.turn.status === 'settling'
  )
    throw new Error('Expected a running provider turn.');
  return reduceSession(state, {
    ...observed,
    correlation: state.turn.correlation,
    providerResourceId: 'provider_01',
    request: interactiveRequest,
    scope: { kind: 'turn', turnId: 'turn_01' },
    type: 'provider.interaction_requested',
  });
};

test('admits several pending requests and queues their durable events', () => {
  const first = request(streamingSessionState(), permission('request_01'));
  if (first.state.status !== 'running') throw new Error('Expected a running session.');
  const second = request(first.state, permission('request_02'));

  expect(second.state.interactions.map(({ request: value }) => value.requestId)).toEqual([
    'request_01',
    'request_02',
  ]);
  expect(second.state.events.pending).toMatchObject([{ type: 'interaction.requested' }]);
  expect(second.effects).toEqual([]);
});

test('treats an identical provider retry as idempotent', () => {
  const value = permission('request_01');
  const first = request(streamingSessionState(), value);
  if (first.state.status !== 'running') throw new Error('Expected a running session.');
  const duplicate = request(first.state, {
    ...value,
    action: { ...value.action },
    options: value.options.map((option) => ({ ...option })),
  });

  expect(duplicate).toEqual({ effects: [], state: first.state });
});

test('fails closed on a conflicting provider retry', () => {
  const first = request(streamingSessionState(), permission('request_01'));
  if (first.state.status !== 'running') throw new Error('Expected a running session.');
  const conflict = request(first.state, {
    ...permission('request_01'),
    action: { kind: 'delete' },
  });

  expect(conflict.state).toMatchObject({
    intent: { error: { code: 'revo.agent.interaction_conflict' }, outcome: 'failed' },
    status: 'cancelling',
  });
});

test('fails closed when the provider exceeds the pending limit', () => {
  const first = request(streamingSessionState(), permission('request_01'));
  if (first.state.status !== 'running') throw new Error('Expected a running session.');
  const second = request(first.state, permission('request_02'));
  if (second.state.status !== 'running') throw new Error('Expected a running session.');
  const overflow = request(second.state, permission('request_03'));

  expect(overflow.state).toMatchObject({
    intent: { error: { code: 'revo.agent.session_backpressure' }, outcome: 'failed' },
    status: 'cancelling',
  });
});

test('fails closed when the provider emits a capability it did not negotiate', () => {
  const initial = streamingSessionState();
  const state = {
    ...initial,
    capabilities: {
      ...initial.capabilities,
      interactions: { ...initial.capabilities.interactions, permission: false },
    },
  };
  const transition = request(state, permission('request_01'));

  expect(transition.state).toMatchObject({
    intent: { error: { code: 'revo.agent.protocol_failed' }, outcome: 'failed' },
    status: 'cancelling',
  });
});

test('ignores an interaction from a stale provider turn', () => {
  const state = streamingSessionState();
  const transition = reduceSession(state, {
    ...observed,
    correlation: { ...state.turn.correlation, turnId: 'turn_old' },
    providerResourceId: 'provider_01',
    request: permission('request_01'),
    scope: { kind: 'turn', turnId: 'turn_old' },
    type: 'provider.interaction_requested',
  });

  expect(transition).toEqual({ effects: [], state });
});

test('ignores an interaction after the provider turn starts settling', () => {
  const streaming = streamingSessionState();
  const state: SessionState = {
    ...streaming,
    turn: {
      ...streaming.turn,
      progress: { outcome: { status: 'completed' }, stage: 'publishing_completion' },
      status: 'settling',
    },
  };
  const transition = reduceSession(state, {
    ...observed,
    correlation: streaming.turn.correlation,
    providerResourceId: 'provider_01',
    request: permission('request_late'),
    scope: { kind: 'turn', turnId: streaming.turn.turnId },
    type: 'provider.interaction_requested',
  });

  expect(transition).toEqual({ effects: [], state });
});
