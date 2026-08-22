import { expect, test } from 'vitest';

import type { ResultSchemaValidator } from '../../../src/runtime/execution/index.js';
import { createAcceptedInvocationLifecycleSubject } from '../../support/lifecycle-conformance/create-accepted-invocation-lifecycle-subject.js';
import { createLifecycleConformanceSubject } from '../../support/lifecycle-conformance/create-lifecycle-conformance-subject.js';
import { waitForLifecycleConformanceQuiescence } from '../../support/lifecycle-conformance/wait-for-lifecycle-conformance-quiescence.js';

test('normalizes a valid object into an immutable success result without raw response payload', async () => {
  const subject = createLifecycleConformanceSubject();
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  const accepted = await subject.start(subject.createInput('valid-object'));
  if (accepted.status !== 'accepted')
    throw new Error('Expected valid object invocation acceptance.');

  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{"value":1}'));
  await waitForLifecycleConformanceQuiescence();

  const result = await accepted.handle.result();
  expect(result).toMatchObject({ status: 'succeeded', value: { value: 1 } });
  expect(Object.isFrozen(result)).toBe(true);
  if (result.status !== 'succeeded') throw new Error('Expected succeeded result.');
  expect(Object.isFrozen(result.value)).toBe(true);
  expect(Object.hasOwn(result, 'rawResponse')).toBe(false);
});

test.each([
  ['missing', undefined, 'response_missing', { byteLength: 0, truncated: false }],
  ['empty', new Uint8Array(), 'response_empty', { byteLength: 0, truncated: false }],
  [
    'over-limit',
    new Uint8Array(1_048_577),
    'response_too_large',
    { byteLength: 1_048_577, truncated: true },
  ],
  [
    'invalid-utf8',
    new Uint8Array([0xc3, 0x28]),
    'response_invalid_utf8',
    { byteLength: 2, truncated: false },
  ],
  [
    'invalid-json',
    new TextEncoder().encode('{'),
    'response_invalid_json',
    { byteLength: 1, truncated: false },
  ],
  [
    'json-primitive',
    new TextEncoder().encode('1'),
    'response_json_primitive',
    { byteLength: 1, truncated: false },
  ],
  [
    'json-array',
    new TextEncoder().encode('[]'),
    'response_json_array',
    { byteLength: 2, truncated: false },
  ],
  [
    'exact-limit',
    new Uint8Array(1_048_576),
    'response_invalid_json',
    { byteLength: 1_048_576, truncated: false },
  ],
] as const)(
  'reports exact raw diagnostics for %s responses',
  async (_, rawResponse, _reason, _rawResponseDiagnostic) => {
    const subject = createLifecycleConformanceSubject();
    subject.output.enqueueTerminalResultRecording();
    subject.execution.enqueueStart('running');
    const accepted = await subject.start(subject.createInput(`raw-${_}`));
    if (accepted.status !== 'accepted')
      throw new Error('Expected raw response invocation acceptance.');

    await waitForLifecycleConformanceQuiescence();
    if (rawResponse === undefined) subject.execution.settleNaturalCompletion(1);
    else subject.execution.settleNaturalCompletion(1, rawResponse);
    await waitForLifecycleConformanceQuiescence();

    await expect(accepted.handle.result()).resolves.toMatchObject({ status: 'failed' });
  },
);

test('returns bounded normalized schema diagnostics with exact raw response metadata', async () => {
  const subject = createLifecycleConformanceSubject();
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  const accepted = await subject.start(
    subject.createInput('schema-mismatch', {
      resultSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { requiredValue: { type: 'string' } },
        required: ['requiredValue'],
      },
    }),
  );
  if (accepted.status !== 'accepted')
    throw new Error('Expected schema mismatch invocation acceptance.');

  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{}'));
  await waitForLifecycleConformanceQuiescence();

  await expect(accepted.handle.result()).resolves.toMatchObject({
    status: 'failed',
    failure: { kind: 'result_schema', code: 'revo.agent.result_schema_mismatch' },
  });
});

test('maps a throwing accepted-lifecycle validator to one redacted terminal failure', async () => {
  const validator: ResultSchemaValidator = Object.freeze({
    validate: () => {
      throw new Error('validator secret');
    },
  });
  const subject = createAcceptedInvocationLifecycleSubject(validator);
  subject.output.enqueueTerminalResultRecording();
  subject.execution.enqueueStart('running');
  subject.lifecycle.begin();

  await waitForLifecycleConformanceQuiescence();
  subject.execution.settleNaturalCompletion(1, new TextEncoder().encode('{"value":1}'));
  await waitForLifecycleConformanceQuiescence();

  expect(subject.terminalSettlements()).toMatchObject([{ status: 'failed' }]);
  expect(
    subject.output.calls().filter((call) => call.type === 'record-terminal-result'),
  ).toHaveLength(1);
  expect(JSON.stringify(subject.terminalSettlements())).not.toContain('validator secret');
});
