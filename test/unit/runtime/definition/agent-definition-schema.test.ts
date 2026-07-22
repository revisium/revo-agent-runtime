import { expect, test } from 'vitest';

import {
  parseAndClassifyAgentDefinition,
  rawAgentDefinitionSchema,
} from '../../../../src/runtime/definition/index.js';
import { AgentManagerError } from '../../../../src/runtime/errors/index.js';
import {
  AGENT_FAULT_MESSAGES,
  AGENT_RUNTIME_LIMITS,
} from '../../../../src/runtime/policy/index.js';
import type { AgentFault } from '../../../../src/runtime/spec/index.js';
import {
  buildAgentDefinition,
  p1ObjectSchema,
} from '../../../support/definition/build-agent-definition.js';

const definitionInvalidFault: AgentFault = {
  code: 'revo.agent.definition_invalid',
  message: AGENT_FAULT_MESSAGES.definitionInvalid,
  phase: 'construction',
  retryable: false,
};

const strategyUnsupportedFault: AgentFault = {
  code: 'revo.agent.strategy_unsupported',
  message: AGENT_FAULT_MESSAGES.strategyUnsupported,
  phase: 'construction',
  retryable: false,
};

const faultFrom = (operation: () => unknown): AgentFault => {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof AgentManagerError) return error.fault;
    throw error;
  }

  throw new Error('Expected an AgentManagerError.');
};

const hasUnknownKey = (value: unknown): boolean =>
  !rawAgentDefinitionSchema.safeParse(value).success;

test.each([
  ['root', (value: ReturnType<typeof buildAgentDefinition>) => ({ ...value, unexpected: true })],
  [
    'launch',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      launch: { ...value.launch, unexpected: true },
    }),
  ],
  [
    'version probe',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      launch: {
        ...value.launch,
        versionProbe: { ...value.launch.versionProbe!, unexpected: true },
      },
    }),
  ],
  [
    'literal argument template',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      launch: { ...value.launch, args: [{ kind: 'literal', value: 'x', unexpected: true }] },
    }),
  ],
  [
    'protocol',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      protocol: { ...value.protocol, unexpected: true },
    }),
  ],
  [
    'delivery',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      delivery: { ...value.delivery, unexpected: true },
    }),
  ],
  [
    'parameters',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      parameters: { ...value.parameters, unexpected: true },
    }),
  ],
  [
    'permissions',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      permissions: { ...value.permissions, unexpected: true },
    }),
  ],
  [
    'capabilities',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      capabilities: { ...value.capabilities, unexpected: true },
    }),
  ],
  [
    'constraints',
    (value: ReturnType<typeof buildAgentDefinition>) => ({
      ...value,
      constraints: { ...value.constraints!, unexpected: true },
    }),
  ],
] as const)('rejects an unknown key in %s', (_name, addUnknownKey) => {
  expect(hasUnknownKey(addUnknownKey(buildAgentDefinition()))).toBe(true);
});

test.each([
  { kind: 'literal', value: 'x', unexpected: true },
  { kind: 'workspace', unexpected: true },
  { kind: 'prompt', unexpected: true },
  { kind: 'prompt-file', unexpected: true },
  { kind: 'result-schema', unexpected: true },
  { kind: 'result-schema-file', unexpected: true },
  { kind: 'parameter', name: 'parameter', unexpected: true },
  { kind: 'permission', name: 'permission', unexpected: true },
])('rejects an unknown key in an argument-template variant', (argumentTemplate) => {
  const definition = buildAgentDefinition();
  expect(
    hasUnknownKey({
      ...definition,
      launch: { ...definition.launch, args: [argumentTemplate] },
    }),
  ).toBe(true);
});

test.each([
  (() => {
    const definition = buildAgentDefinition();
    return {
      ...definition,
      launch: {
        ...definition.launch,
        versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: '1000' },
      },
    };
  })(),
  { ...buildAgentDefinition(), id: 1 },
  (() => {
    const definition = buildAgentDefinition();
    const { permissionStrategy: _permissionStrategy, ...protocol } = definition.protocol;
    return { ...definition, protocol };
  })(),
  {
    ...buildAgentDefinition(),
    delivery: { prompt: 'argument', resultSchema: 'argument', result: 'file' },
  },
  {
    ...buildAgentDefinition(),
    capabilities: { cancellation: true, structuredResult: false, usage: true },
  },
  { ...buildAgentDefinition(), schemaVersion: 'agent-definition/v2' },
  buildAgentDefinition({ id: '😀'.repeat(AGENT_RUNTIME_LIMITS.agentIdentityBytes) }),
  buildAgentDefinition({ constraints: { platforms: ['darwin', 'linux', 'win32', 'linux'] } }),
])('rejects a nonconforming raw DTO', (value) => {
  expect(hasUnknownKey(value)).toBe(true);
  const fault = faultFrom(() => parseAndClassifyAgentDefinition(value, 0));
  expect(fault).toEqual(definitionInvalidFault);
  expect(Object.isFrozen(fault)).toBe(true);
});

test('rejects an explicitly undefined exact-optional field in the raw DTO', () => {
  expect(hasUnknownKey({ ...buildAgentDefinition(), description: undefined })).toBe(true);
});

test('propagates a plain-JSON preflight fault before raw DTO parsing', () => {
  const definition = Object.defineProperty({}, 'schemaVersion', {
    enumerable: true,
    get: () => 'agent-definition/v1',
  });

  expect(faultFrom(() => parseAndClassifyAgentDefinition(definition, 0))).toMatchObject({
    code: 'revo.agent.definition_invalid',
    phase: 'construction',
    retryable: false,
  });
});

test.each([
  { driver: 'future/v1', resultParser: 'codex-jsonl/v1', permissionStrategy: 'codex-cli/v1' },
  { driver: 'native/stdio-v1', resultParser: 'future/v1', permissionStrategy: 'codex-cli/v1' },
  { driver: 'native/stdio-v1', resultParser: 'codex-jsonl/v1', permissionStrategy: 'future/v1' },
] as const)('rejects each unknown strategy with the sanitized strategy fault', (protocol) => {
  const fault = faultFrom(() =>
    parseAndClassifyAgentDefinition(buildAgentDefinition({ protocol }), 0),
  );

  expect(fault).toEqual(strategyUnsupportedFault);
  expect(Object.isFrozen(fault)).toBe(true);
  expect(fault.details).toBeUndefined();
  expect(JSON.stringify(fault)).not.toContain('Zod');
});

test('admits known strategies without enforcing Task 7B coherence', () => {
  const acp = parseAndClassifyAgentDefinition(
    buildAgentDefinition({
      protocol: { driver: 'acp/v1', permissionStrategy: 'acp/v1' },
    }),
    0,
  );
  const native = parseAndClassifyAgentDefinition(
    buildAgentDefinition({
      protocol: {
        driver: 'native/stdio-v1',
        resultParser: 'claude-stream-json/v1',
        permissionStrategy: 'claude-cli/v1',
      },
    }),
    0,
  );

  expect(acp.protocol).toEqual({ driver: 'acp/v1', permissionStrategy: 'acp/v1' });
  expect('resultParser' in acp.protocol).toBe(false);
  expect(native.protocol).toEqual({
    driver: 'native/stdio-v1',
    resultParser: 'claude-stream-json/v1',
    permissionStrategy: 'claude-cli/v1',
  });
  expect(p1ObjectSchema).toEqual(buildAgentDefinition().parameters.schema);
});
