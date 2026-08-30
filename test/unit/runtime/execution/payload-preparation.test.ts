import { expect, test } from 'vitest';

import { prepareInvocationPayloads } from '../../../../src/runtime/execution/index.js';

const schemaBytes = new TextEncoder().encode('{"type":"object"}');

const baseRequest = {
  interpretedArgumentTemplate: [
    { kind: 'arguments' as const, arguments: ['exec'] },
    { kind: 'prompt' as const },
    { kind: 'result-schema' as const },
  ],
  outputResourcePlan: {
    invocationId: 'payloads',
    outputDirectory: '/outputs/invocation',
    needsPromptFile: false,
    needsResultSchemaFile: false,
  },
  prompt: 'Return JSON.',
  resultSchemaBytes: schemaBytes,
};

test('renders prompt and result schema placeholders as argv for argument delivery', () => {
  const prepared = prepareInvocationPayloads({
    ...baseRequest,
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
    },
  });

  expect(prepared).toEqual({
    status: 'prepared',
    payloads: {
      arguments: ['exec', 'Return JSON.', '{"type":"object"}'],
      files: [],
    },
  });
});

test('routes prompt stdin and result schema file delivery outside argv without mutating files', () => {
  const prepared = prepareInvocationPayloads({
    ...baseRequest,
    interpretedArgumentTemplate: [
      { kind: 'arguments' as const, arguments: ['exec'] },
      { kind: 'result-schema-file' as const },
    ],
    outputResourcePlan: {
      invocationId: 'payloads',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: true,
    },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'stdin', resultSchema: 'file', result: 'stdout' },
    },
  });

  expect(prepared).toEqual({
    status: 'prepared',
    payloads: {
      arguments: ['exec', '/outputs/invocation/.scratch/result-schema.json'],
      stdin: new TextEncoder().encode('Return JSON.'),
      files: [
        {
          kind: 'result-schema',
          path: '/outputs/invocation/.scratch/result-schema.json',
          bytes: schemaBytes,
        },
      ],
    },
  });
});

test('routes prompt file delivery to the fixed scratch prompt slot', () => {
  const prepared = prepareInvocationPayloads({
    ...baseRequest,
    interpretedArgumentTemplate: [
      { kind: 'arguments' as const, arguments: ['exec'] },
      { kind: 'prompt-file' as const },
      { kind: 'result-schema' as const },
    ],
    outputResourcePlan: {
      invocationId: 'payloads',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: true,
      needsResultSchemaFile: false,
    },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
    },
  });

  expect(prepared).toEqual({
    status: 'prepared',
    payloads: {
      arguments: ['exec', '{"type":"object"}'],
      files: [
        {
          kind: 'prompt',
          path: '/outputs/invocation/.scratch/prompt.txt',
          bytes: new TextEncoder().encode('Return JSON.'),
        },
      ],
    },
  });
});

test('rejects protocol delivery because only native stdio is installed', () => {
  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      binding: {
        protocolDriverId: 'acp/v1',
        permissionStrategyId: 'acp/v1',
        delivery: { prompt: 'protocol', resultSchema: 'protocol', result: 'protocol' },
      },
    }),
  ).toEqual({ status: 'rejected' });
});

test('resolves prompt placeholder to a file payload when file delivery owns the prompt slot', () => {
  const prepared = prepareInvocationPayloads({
    ...baseRequest,
    interpretedArgumentTemplate: [
      { kind: 'arguments' as const, arguments: ['exec'] },
      { kind: 'prompt' as const },
      { kind: 'result-schema' as const },
    ],
    outputResourcePlan: {
      invocationId: 'payloads',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: true,
      needsResultSchemaFile: false,
    },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
    },
  });

  expect(prepared).toEqual({
    status: 'prepared',
    payloads: {
      arguments: ['exec', '{"type":"object"}'],
      files: [
        {
          kind: 'prompt',
          path: '/outputs/invocation/.scratch/prompt.txt',
          bytes: new TextEncoder().encode('Return JSON.'),
        },
      ],
    },
  });
});

test('resolves result-schema placeholder to a file payload when file delivery owns the schema slot', () => {
  const prepared = prepareInvocationPayloads({
    ...baseRequest,
    interpretedArgumentTemplate: [
      { kind: 'arguments' as const, arguments: ['exec'] },
      { kind: 'result-schema' as const },
    ],
    outputResourcePlan: {
      invocationId: 'payloads',
      outputDirectory: '/outputs/invocation',
      needsPromptFile: false,
      needsResultSchemaFile: true,
    },
    binding: {
      protocolDriverId: 'native/stdio-v1',
      resultParserId: 'codex-jsonl/v1',
      permissionStrategyId: 'codex-cli/v1',
      delivery: { prompt: 'stdin', resultSchema: 'file', result: 'stdout' },
    },
  });

  expect(prepared).toEqual({
    status: 'prepared',
    payloads: {
      arguments: ['exec'],
      stdin: new TextEncoder().encode('Return JSON.'),
      files: [
        {
          kind: 'result-schema',
          path: '/outputs/invocation/.scratch/result-schema.json',
          bytes: schemaBytes,
        },
      ],
    },
  });
});

test('rejects prompt placeholders that disagree with the delivery tuple or resource plan', () => {
  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'prompt' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'stdin', resultSchema: 'argument', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'prompt' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'file', resultSchema: 'argument', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'prompt' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'protocol', resultSchema: 'argument', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });
});

test('rejects file-template placeholders that disagree with the delivery tuple or resource plan', () => {
  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'prompt-file' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'result-schema-file' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'result-schema-file' as const }],
      outputResourcePlan: {
        invocationId: 'payloads',
        outputDirectory: '/outputs/invocation',
        needsPromptFile: false,
        needsResultSchemaFile: false,
      },
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });
});

test('rejects result-schema placeholders that cannot produce argument or file material', () => {
  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'result-schema' as const }],
      resultSchemaBytes: new Uint8Array([0xff]),
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'argument', resultSchema: 'argument', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'result-schema' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'argument', resultSchema: 'file', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });

  expect(
    prepareInvocationPayloads({
      ...baseRequest,
      interpretedArgumentTemplate: [{ kind: 'result-schema' as const }],
      binding: {
        protocolDriverId: 'native/stdio-v1',
        resultParserId: 'codex-jsonl/v1',
        permissionStrategyId: 'codex-cli/v1',
        delivery: { prompt: 'argument', resultSchema: 'protocol', result: 'stdout' },
      },
    }),
  ).toEqual({ status: 'rejected' });
});
