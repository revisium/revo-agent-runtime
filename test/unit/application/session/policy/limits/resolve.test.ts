import { describe, expect, test } from 'vitest';

import {
  resolveAgentSessionLimits,
  resolveAgentSessionManagerLimits,
} from '../../../../../../src/application/session/policy/limits/resolve.js';
import { AgentManagerError } from '../../../../../../src/contracts/manager.js';

describe('session limits', () => {
  test('resolves the reviewed defaults into frozen values', () => {
    expect(resolveAgentSessionManagerLimits(undefined)).toEqual({
      activeStateOperationTimeoutMs: 5_000,
      maxActiveSessions: 32,
      maxCompletedSessions: 1_000,
      maxOpeningSessions: 4,
      maxSessionIdentities: 10_000,
      recoveryTimeoutMs: 30_000,
    });
    const session = resolveAgentSessionLimits(undefined);
    expect(session).toEqual({
      eventSinkTimeoutMs: 10_000,
      idleTimeoutMs: 900_000,
      maxCheckpointBytes: 1_048_576,
      maxEventBytes: 65_536,
      maxInteractionBytes: 262_144,
      maxMessageBytes: 4_194_304,
      maxMetadataBytes: 65_536,
      maxOutputBytes: 16_777_216,
      maxPendingInteractions: 8,
      maxPromptBytes: 1_048_576,
      openingTimeoutMs: 60_000,
      operationTimeoutMs: 30_000,
      wallClockTimeoutMs: 14_400_000,
    });
    expect(Object.isFrozen(session)).toBe(true);
  });

  test('accepts every inclusive minimum and maximum', () => {
    expect(
      resolveAgentSessionManagerLimits({
        activeStateOperationTimeoutMs: 100,
        maxActiveSessions: 1,
        maxCompletedSessions: 1,
        maxOpeningSessions: 1,
        maxSessionIdentities: 32,
        recoveryTimeoutMs: 1_000,
      }),
    ).toBeDefined();
    expect(
      resolveAgentSessionLimits({
        eventSinkTimeoutMs: 300_000,
        idleTimeoutMs: 86_400_000,
        maxCheckpointBytes: 4_194_304,
        maxEventBytes: 1_048_576,
        maxInteractionBytes: 1_048_576,
        maxMessageBytes: 16_777_216,
        maxMetadataBytes: 262_144,
        maxOutputBytes: 67_108_864,
        maxPendingInteractions: 32,
        maxPromptBytes: 4_194_304,
        openingTimeoutMs: 600_000,
        operationTimeoutMs: 300_000,
        wallClockTimeoutMs: 604_800_000,
      }),
    ).toBeDefined();
    expect(
      resolveAgentSessionLimits({
        eventSinkTimeoutMs: 100,
        idleTimeoutMs: 1_000,
        maxCheckpointBytes: 1_024,
        maxEventBytes: 1_024,
        maxInteractionBytes: 1_024,
        maxMessageBytes: 1_024,
        maxMetadataBytes: 2,
        maxOutputBytes: 1_024,
        maxPendingInteractions: 1,
        maxPromptBytes: 1,
        openingTimeoutMs: 1_000,
        operationTimeoutMs: 100,
        wallClockTimeoutMs: 1_000,
      }),
    ).toBeDefined();
  });

  test.each([
    { maxActiveSessions: 0 },
    { maxOpeningSessions: 33 },
    { maxCompletedSessions: 1.5 },
    { maxSessionIdentities: 35 },
    { unknown: 1 },
    null,
    [],
    Object.create({ inherited: true }),
    new Proxy({}, {}),
  ])('rejects invalid manager limits %#', (input) => {
    expect(() => resolveAgentSessionManagerLimits(input)).toThrow(AgentManagerError);
  });

  test.each([
    { openingTimeoutMs: 2_000, wallClockTimeoutMs: 1_000 },
    { idleTimeoutMs: 2_000, wallClockTimeoutMs: 1_000 },
    { operationTimeoutMs: 2_000, wallClockTimeoutMs: 1_000 },
    { eventSinkTimeoutMs: 2_000, operationTimeoutMs: 1_000 },
    { maxPromptBytes: 0 },
    { maxPendingInteractions: 33 },
    { unknown: 1 },
  ])('rejects invalid request limits %#', (input) => {
    expect(() => resolveAgentSessionLimits(input)).toThrow(AgentManagerError);
  });
});
