import { createHash } from 'node:crypto';

import { expect, test } from 'vitest';

import * as runtimeExecution from '../../../../src/runtime/execution/index.js';
import {
  beginOutputClaim,
  createOutputClaimAttempt,
  type ExecutionBinding,
  type OutputResourcePlan,
  type PreparedInvocationMaterial,
  type PreparedInvocationPayloads,
} from '../../../../src/runtime/execution/index.js';
import { ConsumedOutputPreparationMaterial } from '../../../../src/runtime/execution/output-preparation-attempt/consumed-output-preparation-material.js';
import {
  createOutputPreparationAttempt,
  getOutputPreparationInvocationToken,
  isConsumedOutputPreparationMaterialBoundToToken,
  type OutputPreparationAttempt,
} from '../../../../src/runtime/execution/output-preparation-attempt/index.js';
import {
  consumeOutputPreparationMaterial,
  createPreparedInvocation,
  PreparedInvocation,
} from '../../../../src/runtime/execution/prepared-invocation/index.js';
import { FakeInvocationClock } from '../../../support/execution/fake-clock.js';
import { FakeOutputClaimPort } from '../../../support/execution/fake-output-claim-port.js';
import { FakeOutputPreparationPort } from '../../../support/execution/fake-output-preparation-port.js';

const outputDirectory = '/outputs/prepared-invocation';
const promptPath = `${outputDirectory}/.scratch/prompt.txt`;
const resultSchemaPath = `${outputDirectory}/.scratch/result-schema.json`;

const binding: ExecutionBinding = Object.freeze({
  protocolDriverId: 'native/stdio-v1',
  resultParserId: 'codex-jsonl/v1',
  permissionStrategyId: 'codex-cli/v1',
  delivery: Object.freeze({ prompt: 'file', resultSchema: 'file', result: 'stdout' }),
});

const plan: OutputResourcePlan = Object.freeze({
  invocationId: 'prepared-invocation-test',
  outputDirectory,
  needsPromptFile: true,
  needsResultSchemaFile: true,
});

const bytes = (values: readonly number[]): Uint8Array => new Uint8Array(values);

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const payloads = (
  files: PreparedInvocationPayloads['files'] = Object.freeze([
    Object.freeze({ kind: 'prompt', path: promptPath, bytes: bytes([1, 2, 3]) }),
    Object.freeze({ kind: 'result-schema', path: resultSchemaPath, bytes: bytes([4, 5]) }),
  ]),
): PreparedInvocationPayloads => Object.freeze({ arguments: Object.freeze([]), files });

const material = (
  overrides: Partial<PreparedInvocationMaterial> = {},
): PreparedInvocationMaterial => ({
  pin: Object.freeze({ agentId: 'codex', agentVersion: '1.0.0', definitionDigest: 'digest' }),
  workspaceDirectory: '/workspace/project',
  reportedVersion: '1.2.3',
  binding,
  outputResourcePlan: plan,
  preparedPayloads: payloads(),
  ...overrides,
});

const requireInvocation = (input: PreparedInvocationMaterial = material()): PreparedInvocation => {
  const invocation = createPreparedInvocation(input);
  if (invocation === undefined) throw new Error('Expected prepared invocation.');
  return invocation;
};

const claimedSession = async (inputPlan = plan) => {
  const clock = new FakeInvocationClock({ initialNowMs: 1_000 });
  const port = new FakeOutputClaimPort();
  port.enqueue('created');
  const claim = createOutputClaimAttempt({
    invocationId: inputPlan.invocationId,
    outputDirectory: inputPlan.outputDirectory,
    clock,
    port,
  });
  beginOutputClaim(claim);
  const result = await claim.settlement;
  if (result.status !== 'claimed') throw new Error('Expected claimed output session.');
  return result.session;
};

const preparationAttempt = async (inputPlan = plan): Promise<OutputPreparationAttempt> => {
  const attempt = createOutputPreparationAttempt({
    session: await claimedSession(inputPlan),
    clock: new FakeInvocationClock({ initialNowMs: 1_000 }),
    port: new FakeOutputPreparationPort(),
  });
  if (attempt === undefined) throw new Error('Expected output preparation attempt.');
  return attempt;
};

test('creates an authentic frozen carrier with only the spec visible fields in order', () => {
  const invocation = requireInvocation();

  expect(Reflect.ownKeys(invocation).map(String)).toEqual([
    'invocationId',
    'pin',
    'workspaceDirectory',
    'outputDirectory',
    'reportedVersion',
    'binding',
  ]);
  expect(Object.isFrozen(invocation)).toBe(true);
  expect(Object.isFrozen(invocation.pin)).toBe(true);
  expect(Object.isFrozen(invocation.binding)).toBe(true);
  expect(Object.isFrozen(invocation.binding.delivery)).toBe(true);
});

test.each([
  ['workspaceDirectory', { workspaceDirectory: '   ' }],
  ['reportedVersion', { reportedVersion: '' }],
  ['pin.agentId', { pin: { agentId: '', agentVersion: '1.0.0', definitionDigest: 'digest' } }],
  ['pin.agentVersion', { pin: { agentId: 'codex', agentVersion: '', definitionDigest: 'digest' } }],
  [
    'pin.definitionDigest',
    { pin: { agentId: 'codex', agentVersion: '1.0.0', definitionDigest: '' } },
  ],
  ['outputResourcePlan.invocationId', { outputResourcePlan: { ...plan, invocationId: '' } }],
  ['outputResourcePlan.outputDirectory', { outputResourcePlan: { ...plan, outputDirectory: '' } }],
] as const)('rejects empty required string %s', (_name, overrides) => {
  expect(createPreparedInvocation(material(overrides))).toBeUndefined();
});

test.each([
  ['unrecognized protocolDriverId', { ...binding, protocolDriverId: 'unknown' }],
  ['missing delivery.result', { ...binding, delivery: { prompt: 'file', resultSchema: 'file' } }],
  [
    'extra delivery key',
    {
      ...binding,
      delivery: { prompt: 'file', resultSchema: 'file', result: 'stdout', extra: 'x' },
    },
  ],
] as const)('rejects invalid binding shape: %s', (_name, candidate) => {
  expect(
    Reflect.apply(createPreparedInvocation, undefined, [{ ...material(), binding: candidate }]),
  ).toBeUndefined();
});

test.each([
  [
    'prompt file delivery without prompt-file plan',
    { ...binding, delivery: { ...binding.delivery, prompt: 'file' } },
    { ...plan, needsPromptFile: false },
  ],
  [
    'prompt-file plan without file delivery',
    { ...binding, delivery: { ...binding.delivery, prompt: 'stdin' } },
    { ...plan, needsPromptFile: true },
  ],
  [
    'schema file delivery without schema-file plan',
    { ...binding, delivery: { ...binding.delivery, resultSchema: 'file' } },
    { ...plan, needsResultSchemaFile: false },
  ],
  [
    'schema-file plan without file delivery',
    { ...binding, delivery: { ...binding.delivery, resultSchema: 'argument' } },
    { ...plan, needsResultSchemaFile: true },
  ],
] as const)('rejects binding-to-plan mismatch: %s', (_name, inputBinding, inputPlan) => {
  expect(
    createPreparedInvocation(
      material({
        binding: inputBinding,
        outputResourcePlan: inputPlan,
        preparedPayloads: payloads(Object.freeze([])),
      }),
    ),
  ).toBeUndefined();
});

test('derives prompt and result-schema file slots with independent SHA-256 attestations', async () => {
  const promptBytes = bytes([10, 11, 12]);
  const schemaBytes = bytes([13, 14]);
  const invocation = requireInvocation(
    material({
      preparedPayloads: payloads(
        Object.freeze([
          Object.freeze({ kind: 'prompt', path: promptPath, bytes: promptBytes }),
          Object.freeze({ kind: 'result-schema', path: resultSchemaPath, bytes: schemaBytes }),
        ]),
      ),
    }),
  );

  const consumed = consumeOutputPreparationMaterial(invocation, await preparationAttempt());
  if (consumed === undefined) throw new Error('Expected consumed material.');
  const files = ConsumedOutputPreparationMaterial.take(consumed);

  expect(files).toEqual([
    {
      slot: 'prompt',
      path: promptPath,
      bytes: promptBytes,
      expectedByteLength: promptBytes.byteLength,
      expectedSha256: sha256(promptBytes),
    },
    {
      slot: 'result-schema',
      path: resultSchemaPath,
      bytes: schemaBytes,
      expectedByteLength: schemaBytes.byteLength,
      expectedSha256: sha256(schemaBytes),
    },
  ]);
});

test('derives an empty one-use file-slot bundle when no files are needed', () => {
  const noFileBinding = Object.freeze({
    ...binding,
    delivery: Object.freeze({ prompt: 'stdin', resultSchema: 'argument', result: 'stdout' }),
  });
  const noFilePlan = Object.freeze({
    ...plan,
    needsPromptFile: false,
    needsResultSchemaFile: false,
  });
  const invocation = requireInvocation(
    material({
      binding: noFileBinding,
      outputResourcePlan: noFilePlan,
      preparedPayloads: payloads(Object.freeze([])),
    }),
  );

  expect(PreparedInvocation.takeOutputPreparation(invocation)?.files).toEqual([]);
  expect(PreparedInvocation.takeOutputPreparation(invocation)).toBeUndefined();
});

test('defensively copies payload bytes before caller mutation', () => {
  const source = bytes([21, 22, 23]);
  const expectedHash = sha256(source);
  const invocation = requireInvocation(
    material({
      binding: { ...binding, delivery: { ...binding.delivery, resultSchema: 'argument' } },
      outputResourcePlan: { ...plan, needsResultSchemaFile: false },
      preparedPayloads: payloads(
        Object.freeze([Object.freeze({ kind: 'prompt', path: promptPath, bytes: source })]),
      ),
    }),
  );

  source.fill(9);

  const file = PreparedInvocation.takeOutputPreparation(invocation)?.files[0];
  expect(file?.bytes).toEqual(bytes([21, 22, 23]));
  expect(file?.expectedSha256).toBe(expectedHash);
});

test('keeps taken payload bytes distinct and mutable for future adapter zero-fill', () => {
  const source = bytes([31, 32, 33]);
  const invocation = requireInvocation(
    material({
      binding: { ...binding, delivery: { ...binding.delivery, resultSchema: 'argument' } },
      outputResourcePlan: { ...plan, needsResultSchemaFile: false },
      preparedPayloads: payloads(
        Object.freeze([Object.freeze({ kind: 'prompt', path: promptPath, bytes: source })]),
      ),
    }),
  );

  const taken = PreparedInvocation.takeOutputPreparation(invocation);
  const takenBytes = taken?.files[0]?.bytes;
  if (takenBytes === undefined) throw new Error('Expected taken bytes.');

  expect(takenBytes).not.toBe(source);
  takenBytes.fill(0);
  expect(source).toEqual(bytes([31, 32, 33]));
});

test.each([
  [
    'wrong prompt path',
    [Object.freeze({ kind: 'prompt', path: `${outputDirectory}/prompt.txt`, bytes: bytes([1]) })],
  ],
  [
    'duplicate prompt slot',
    [
      Object.freeze({ kind: 'prompt', path: promptPath, bytes: bytes([1]) }),
      Object.freeze({ kind: 'prompt', path: promptPath, bytes: bytes([2]) }),
    ],
  ],
] as const)('rejects invalid prepared payload files: %s', (_name, files) => {
  expect(
    createPreparedInvocation(material({ preparedPayloads: payloads(Object.freeze(files)) })),
  ).toBeUndefined();
});

test('consume helper authenticates invocation and attempt, checks both path fields, and consumes once', async () => {
  const invocation = requireInvocation();
  const attempt = await preparationAttempt();

  const consumed = consumeOutputPreparationMaterial(invocation, attempt);

  expect(consumed).toBeDefined();
  if (consumed === undefined) throw new Error('Expected consumed material.');
  expect(Reflect.ownKeys(consumed).map(String)).toEqual(['invocationId', 'outputDirectory']);
  expect(Object.isFrozen(consumed)).toBe(true);
  expect(consumeOutputPreparationMaterial(invocation, attempt)).toBeUndefined();
  expect(
    consumeOutputPreparationMaterial(
      {
        invocationId: invocation.invocationId,
        pin: invocation.pin,
        workspaceDirectory: invocation.workspaceDirectory,
        outputDirectory: invocation.outputDirectory,
        reportedVersion: invocation.reportedVersion,
        binding: invocation.binding,
      },
      await preparationAttempt(),
    ),
  ).toBeUndefined();
  expect(
    consumeOutputPreparationMaterial(requireInvocation(), {
      invocationId: plan.invocationId,
      outputDirectory: plan.outputDirectory,
    }),
  ).toBeUndefined();
  expect(
    consumeOutputPreparationMaterial(
      requireInvocation(),
      await preparationAttempt({ ...plan, invocationId: 'other-invocation' }),
    ),
  ).toBeUndefined();
  expect(
    consumeOutputPreparationMaterial(
      requireInvocation(),
      await preparationAttempt({ ...plan, outputDirectory: '/outputs/other' }),
    ),
  ).toBeUndefined();
});

test('consumed material token verifier rejects foreign tokens and sibling carrier authorities', async () => {
  const attempt = await preparationAttempt();
  const materialFromAttempt = consumeOutputPreparationMaterial(requireInvocation(), attempt);
  if (materialFromAttempt === undefined) throw new Error('Expected consumed material.');
  const attemptToken = getOutputPreparationInvocationToken(attempt);
  if (attemptToken === undefined) throw new Error('Expected attempt token.');

  expect(isConsumedOutputPreparationMaterialBoundToToken(materialFromAttempt, attemptToken)).toBe(
    true,
  );
  expect(
    isConsumedOutputPreparationMaterialBoundToToken(materialFromAttempt, Object.freeze({})),
  ).toBe(false);
  expect(isConsumedOutputPreparationMaterialBoundToToken(attempt.authority, attemptToken)).toBe(
    false,
  );
});

test('consumed output material survives base freeze and still supports one private-field take', () => {
  const files = Object.freeze([
    Object.freeze({
      slot: 'prompt',
      path: promptPath,
      bytes: bytes([1]),
      expectedByteLength: 1,
      expectedSha256: sha256(bytes([1])),
    }),
  ]);
  const consumed = ConsumedOutputPreparationMaterial.create({
    invocationId: plan.invocationId,
    outputDirectory: plan.outputDirectory,
    invocationToken: Object.freeze({}),
    files,
  });

  expect(Object.isFrozen(consumed)).toBe(true);
  expect(ConsumedOutputPreparationMaterial.take(consumed)).toBe(files);
  expect(ConsumedOutputPreparationMaterial.take(consumed)).toBeUndefined();
});

test('runtime execution layer barrel does not expose prepared-invocation values', () => {
  expect('createPreparedInvocation' in runtimeExecution).toBe(false);
  expect('consumeOutputPreparationMaterial' in runtimeExecution).toBe(false);
  expect('PreparedInvocation' in runtimeExecution).toBe(false);
});
