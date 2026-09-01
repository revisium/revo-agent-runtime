import { describe, expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import {
  protocolDriverContractSubjects,
  type ProtocolDriverContractRun,
  type ProtocolDriverContractSubject,
} from '../../support/stories/protocol-driver-contract.js';

const expectedDriverInput = (directory: string) => ({
  parameters: { format: 'structured', maxTurns: 1 },
  permissions: { filesystem: 'read-only' },
  prompt: 'Return the protocol contract result.',
  resultSchema: { type: 'object' },
  workspace: directory,
});

const publicDetails = async (run: ProtocolDriverContractRun) => {
  const result = await run.result();
  return JSON.stringify({ events: run.events(), result });
};

const withRun = async (
  subject: ProtocolDriverContractSubject,
  scenario: Parameters<ProtocolDriverContractSubject['start']>[1],
  verify: (run: ProtocolDriverContractRun, directory: string) => Promise<void>,
  options?: Parameters<ProtocolDriverContractSubject['start']>[2],
): Promise<void> => {
  await withTemporaryDirectory(async (directory) => {
    const run = await subject.start(directory, scenario, options);
    try {
      await verify(run, directory);
    } finally {
      await run.dispose();
    }
  });
};

const describeProtocolDriverContract = (subject: ProtocolDriverContractSubject): void => {
  describe(`${subject.name} ProtocolDriver`, () => {
    test('delivers the exact invocation input and finishes only after close, cleanup, and state removal', async () => {
      await withRun(subject, 'normal', async (run, directory) => {
        const result = await run.result();

        expect(run.input()).toEqual(expectedDriverInput(directory));
        expect(result.status).toBe('succeeded');
        if (result.status !== 'succeeded') throw new Error('Expected a successful contract run.');
        expect(typeof result.value.answer).toBe('string');
        expect(run.events()).toEqual([
          'invocation.accepted',
          'invocation.started',
          'invocation.finished',
        ]);
        expect(run.activeState.operations()).toEqual([
          'save:running',
          'remove:protocol-driver-normal',
        ]);
        await expect(Promise.resolve(run.providerCloseCalls())).resolves.toBe(1);
        expect(run.processCleanupCalls()).toBe(1);
      });
    });

    test('rejects permission requests explicitly without exposing provider payloads', async () => {
      await withRun(subject, 'permission', async (run) => {
        const details = await publicDetails(run);

        if (run.providerPermissionDecision !== undefined)
          await expect(run.providerPermissionDecision()).resolves.toEqual({
            optionId: 'reject-native',
            outcome: 'selected',
          });
        expect(details).not.toContain('vendor-schema-payload');
        expect(details).not.toContain('allow-native');
        expect(details).not.toContain('reject-native');
      });
    });

    test('cancels, closes, cleans up, and removes active state even when provider cancellation fails', async () => {
      await withRun(subject, 'cancel', async (run) => {
        await run.ready();
        await run.cancel();
        const result = await run.result();

        expect(result).toMatchObject({ status: 'cancelled' });
        expect(run.events()).toEqual([
          'invocation.accepted',
          'invocation.started',
          'invocation.cancelling',
          'invocation.finished',
        ]);
        expect(run.activeState.operations()).toEqual([
          'save:running',
          'save:cancelling',
          'remove:protocol-driver-cancel',
        ]);
        await expect(Promise.resolve(run.providerCancelCalls())).resolves.toBe(1);
        await expect(Promise.resolve(run.providerCloseCalls())).resolves.toBe(1);
        expect(run.processCleanupCalls()).toBe(1);
      });
    });

    test('keeps the first terminal result when a later process exit arrives', async () => {
      await withRun(subject, 'normal', async (run) => {
        const first = await run.result();
        run.lateProcessExit();

        await expect(run.result()).resolves.toEqual(first);
        expect(first).toMatchObject({ status: 'succeeded' });
        await expect(Promise.resolve(run.providerCloseCalls())).resolves.toBe(1);
        expect(run.processCleanupCalls()).toBe(1);
      });
    });

    test('closes a naturally completed session exactly once', async () => {
      await withRun(subject, 'normal', async (run) => {
        await run.result();

        if (run.wroteAfterClose !== undefined) expect(run.wroteAfterClose()).toBe(false);
        await expect(Promise.resolve(run.providerCloseCalls())).resolves.toBe(1);
      });
    });

    test.each(['malformed', 'provider-failure'] as const)(
      'normalizes %s provider input or failure to a bounded protocol fault',
      async (scenario) => {
        await withRun(subject, scenario, async (run) => {
          const details = await publicDetails(run);

          expect(details).not.toContain('contract-vendor-secret');
          expect(details).not.toContain('/private/provider/path');
          await expect(run.result()).resolves.toMatchObject({
            error: { code: 'revo.agent.protocol_failed' },
            status: 'failed',
          });
        });
      },
    );

    test.each([
      ['missing-result', 'revo.agent.result_missing'],
      ['empty-result', 'revo.agent.result_missing'],
      ['duplicate-result', 'revo.agent.protocol_failed'],
      ['schema-mismatch', 'revo.agent.result_schema_mismatch'],
    ] as const)('normalizes %s with %s', async (scenario, faultCode) => {
      await withRun(
        subject,
        scenario,
        async (run) => {
          await expect(run.result()).resolves.toMatchObject({
            error: { code: faultCode },
            status: 'failed',
          });
        },
        scenario === 'schema-mismatch'
          ? {
              resultSchema: {
                properties: { answer: { type: 'string' } },
                required: ['answer'],
                type: 'object',
              },
            }
          : undefined,
      );
    });
  });
};

for (const subject of protocolDriverContractSubjects) describeProtocolDriverContract(subject);
