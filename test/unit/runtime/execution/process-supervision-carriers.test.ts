import { expect, test } from 'vitest';

import {
  DuplexCoordinatorRegistration,
  duplexCompletion,
  PausedProcessIo,
  SpawnAcceptedProcess,
  submitDuplexCandidate,
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

const completedCandidate = Object.freeze({
  status: 'completed' as const,
  spawnedAt: 1,
  exit: Object.freeze({ exitCode: 0, signal: null }),
});

const failedCandidate = Object.freeze({
  status: 'failed' as const,
  spawnedAt: 1,
  exit: Object.freeze({ exitCode: 1, signal: null }),
  primary: Object.freeze({ kind: 'process_failed' as const }),
});

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

test('duplex coordinator completion is allocated eagerly and resolves to the submitted candidate', async () => {
  const registration = DuplexCoordinatorRegistration.create({
    invocationId: 'duplex-test',
    invocationToken: token,
  });
  const completion = duplexCompletion(registration);

  expect(completion).toBeDefined();
  expect(submitDuplexCandidate(registration, completedCandidate)).toBe(true);
  await expect(completion).resolves.toBe(completedCandidate);
});

test('duplex coordinator keeps the first committed candidate', async () => {
  const registration = DuplexCoordinatorRegistration.create({
    invocationId: 'duplex-test',
    invocationToken: token,
  });
  const completion = duplexCompletion(registration);
  if (completion === undefined) throw new Error('Expected duplex completion to be allocated.');

  expect(submitDuplexCandidate(registration, completedCandidate)).toBe(true);
  expect(submitDuplexCandidate(registration, failedCandidate)).toBe(false);
  await flushPromises();
  await expect(completion).resolves.toBe(completedCandidate);
});

test('duplex candidate submission rejects inauthentic objects without throwing', () => {
  expect(() =>
    submitDuplexCandidate({ invocationId: 'duplex-test' }, completedCandidate),
  ).not.toThrow();
  expect(submitDuplexCandidate({ invocationId: 'duplex-test' }, completedCandidate)).toBe(false);
  expect(duplexCompletion({ invocationId: 'duplex-test' })).toBeUndefined();
});

test('duplex candidate arbitration has no candidate-kind priority', async () => {
  const firstCoordinator = DuplexCoordinatorRegistration.create({
    invocationId: 'duplex-test-a',
    invocationToken: token,
  });
  const firstCompletion = duplexCompletion(firstCoordinator);
  if (firstCompletion === undefined) throw new Error('Expected first completion.');
  expect(submitDuplexCandidate(firstCoordinator, completedCandidate)).toBe(true);
  expect(submitDuplexCandidate(firstCoordinator, failedCandidate)).toBe(false);
  await expect(firstCompletion).resolves.toBe(completedCandidate);

  const secondCoordinator = DuplexCoordinatorRegistration.create({
    invocationId: 'duplex-test-b',
    invocationToken: token,
  });
  const secondCompletion = duplexCompletion(secondCoordinator);
  if (secondCompletion === undefined) throw new Error('Expected second completion.');
  expect(submitDuplexCandidate(secondCoordinator, failedCandidate)).toBe(true);
  expect(submitDuplexCandidate(secondCoordinator, completedCandidate)).toBe(false);
  await expect(secondCompletion).resolves.toBe(failedCandidate);
});

test('duplex coordinator token binding remains exact for cross-invocation checks', () => {
  const otherToken = Object.freeze({ token: 'other-duplex' });
  const registration = DuplexCoordinatorRegistration.create({
    invocationId: 'duplex-test',
    invocationToken: token,
  });

  expect(DuplexCoordinatorRegistration.isBoundToToken(registration, otherToken)).toBe(false);
});
