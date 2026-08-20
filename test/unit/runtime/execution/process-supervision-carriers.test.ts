import { expect, test } from 'vitest';

import {
  DuplexCoordinatorRegistration,
  PausedProcessIo,
  SpawnAcceptedProcess,
} from '../../../../src/runtime/execution/index.js';
import type { InvocationTokenCarrier } from '../../../../src/runtime/execution/index.js';

const token = Object.freeze({ token: 'process-carrier-test' });

const carrierFields = (carrier: InvocationTokenCarrier): readonly string[] =>
  Reflect.ownKeys(carrier).map(String);

test('spawn-accepted process is an authentic frozen invocation-token carrier with informational spawnedAt', () => {
  const process = SpawnAcceptedProcess.create({
    invocationId: 'spawn-test',
    invocationToken: token,
    spawnedAt: 123_456,
  });

  expect(SpawnAcceptedProcess.isAuthentic(process)).toBe(true);
  expect(SpawnAcceptedProcess.isBoundToToken(process, token)).toBe(true);
  expect(carrierFields(process)).toEqual(['invocationId', 'spawnedAt']);
  expect(Object.isFrozen(process)).toBe(true);
});

test.each([
  ['paused process I/O', PausedProcessIo],
  ['duplex coordinator registration', DuplexCoordinatorRegistration],
] as const)('%s is an authentic frozen invocation-only carrier', (_label, Carrier) => {
  const carrier = Carrier.create({
    invocationId: 'activation-test',
    invocationToken: token,
  });

  expect(Carrier.isAuthentic(carrier)).toBe(true);
  expect(Carrier.isBoundToToken(carrier, token)).toBe(true);
  expect(carrierFields(carrier)).toEqual(['invocationId']);
  expect(Object.isFrozen(carrier)).toBe(true);
});

test('process carriers reject forged structural lookalikes and sibling brands', () => {
  const process = SpawnAcceptedProcess.create({
    invocationId: 'spawn-test',
    invocationToken: token,
    spawnedAt: 123_456,
  });
  const io = PausedProcessIo.create({
    invocationId: 'spawn-test',
    invocationToken: token,
  });
  const registration = DuplexCoordinatorRegistration.create({
    invocationId: 'spawn-test',
    invocationToken: token,
  });

  expect(SpawnAcceptedProcess.isAuthentic({ invocationId: 'spawn-test', spawnedAt: 123_456 })).toBe(
    false,
  );
  expect(PausedProcessIo.isAuthentic({ invocationId: 'spawn-test' })).toBe(false);
  expect(DuplexCoordinatorRegistration.isAuthentic({ invocationId: 'spawn-test' })).toBe(false);
  expect(SpawnAcceptedProcess.isAuthentic(io)).toBe(false);
  expect(PausedProcessIo.isAuthentic(process)).toBe(false);
  expect(DuplexCoordinatorRegistration.isAuthentic(process)).toBe(false);
  expect(DuplexCoordinatorRegistration.isAuthentic(registration)).toBe(true);
});

test('process carriers require exact invocation token identity', () => {
  const otherToken = Object.freeze({ token: 'other' });
  const process = SpawnAcceptedProcess.create({
    invocationId: 'spawn-test',
    invocationToken: token,
    spawnedAt: 123_456,
  });
  const io = PausedProcessIo.create({
    invocationId: 'spawn-test',
    invocationToken: token,
  });
  const registration = DuplexCoordinatorRegistration.create({
    invocationId: 'spawn-test',
    invocationToken: token,
  });

  expect(SpawnAcceptedProcess.isBoundToToken(process, otherToken)).toBe(false);
  expect(PausedProcessIo.isBoundToToken(io, otherToken)).toBe(false);
  expect(DuplexCoordinatorRegistration.isBoundToToken(registration, otherToken)).toBe(false);
});
