import { expect, test } from 'vitest';

import type { ProcessStartRequest } from '../../../../src/runtime/execution/index.js';
import { FakeProcessSupervisionPort } from '../../../support/process/fake-process-supervision-port.js';

const request = (): ProcessStartRequest =>
  Object.freeze({
    cwd: process.cwd(),
    executable: '/fixture/bin/agent',
    args: Object.freeze(['--run']),
    environment: Object.freeze({ REFERENCE_PROCESS_ENV: 'candidate' }),
    shell: false,
  });

test('returns the scripted immutable identity for a newly live owned process', async () => {
  const port = new FakeProcessSupervisionPort();
  const source = {
    pid: 421,
    processGroupId: 421,
    fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  port.enqueueStart(source);

  const process = await port.start(request());
  source.pid = 999;

  expect(process.identity).toEqual({
    pid: 421,
    processGroupId: 421,
    fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  expect(Object.isFrozen(process)).toBe(true);
  expect(Object.isFrozen(process.identity)).toBe(true);
  expect(port.calls()).toEqual([request()]);

  port.settle(1);
  await expect(process.completion).resolves.toBeUndefined();
});

test('settles a retained fake process once through its private cleanup capability', async () => {
  const port = new FakeProcessSupervisionPort();
  port.enqueueStart({
    pid: 422,
    processGroupId: 422,
    fingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });

  const process = await port.start(request());
  const firstCleanup = process.terminateAndReap();
  const repeatedCleanup = process.terminateAndReap();

  await expect(firstCleanup).resolves.toBeUndefined();
  await expect(repeatedCleanup).resolves.toBeUndefined();
  await expect(process.completion).resolves.toBeUndefined();
});
