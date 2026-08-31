import { expect, test } from 'vitest';

import { observeProtocol } from '../../../../src/execution/invocation/protocol-policy.js';

test('permission policy explicitly chooses a provider rejection option when available', async () => {
  const protocol = observeProtocol(() => undefined);

  await expect(
    protocol.observer.permission({
      options: [
        { id: 'allow-once', kind: 'allow_once' },
        { id: 'reject-always', kind: 'reject_always' },
      ],
    }),
  ).resolves.toEqual({ optionId: 'reject-always', outcome: 'selected' });
});

test('permission policy denies requests that offer no explicit rejection option', async () => {
  const protocol = observeProtocol(() => undefined);

  await expect(
    protocol.observer.permission({ options: [{ id: 'allow-once', kind: 'allow_once' }] }),
  ).resolves.toEqual({ outcome: 'denied' });
});

test('protocol results fail closed for provider failures and malformed result chunks', () => {
  const providerFailure = observeProtocol(() => undefined);
  expect(providerFailure.result({ status: 'failed' })).toEqual({ status: 'failed' });

  const malformedResult = observeProtocol(() => undefined);
  malformedResult.observer.resultChunk(new TextEncoder().encode('{not-json'));
  expect(malformedResult.result({ status: 'completed' })).toMatchObject({
    code: 'revo.agent.result_invalid_json',
    reason: 'invalid_json',
    status: 'failed',
  });

  const missingResult = observeProtocol(() => undefined);
  const missing = missingResult.result({ status: 'completed' });
  expect(missing).toMatchObject({
    code: 'revo.agent.result_missing',
    status: 'failed',
  });
  if (missing.status !== 'failed') throw new Error('Expected a missing-result failure.');
  expect(missing.evidence).toBeDefined();
});

test('publishes usage only when the selected definition advertises it', () => {
  const advertised = observeProtocol(() => undefined, {
    maxRawResponseBytes: 1_024,
    resultSchema: { type: 'object' },
    secrets: [],
    usage: true,
  });
  advertised.observer.usage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  advertised.observer.resultChunk(new TextEncoder().encode('{}'));

  const unadvertised = observeProtocol(() => undefined);
  unadvertised.observer.usage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  unadvertised.observer.resultChunk(new TextEncoder().encode('{}'));

  expect(advertised.result({ status: 'completed' })).toMatchObject({
    status: 'succeeded',
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
  });
  expect(unadvertised.result({ status: 'completed' })).not.toHaveProperty('usage');
});
