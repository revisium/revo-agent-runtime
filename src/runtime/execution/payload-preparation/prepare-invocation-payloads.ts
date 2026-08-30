import type { InterpretedArgumentTemplate } from '../argument-template-interpretation/index.js';
import type { OutputResourcePlan } from '../output-resource-plan.js';
import type { PreparedInvocationPayloads } from './prepared-invocation-payloads.js';

type PreparedPayloadFile = PreparedInvocationPayloads['files'][number];

interface PayloadPreparationBinding {
  readonly protocolDriverId: 'native/stdio-v1' | 'acp/v1';
  readonly resultParserId?: 'codex-jsonl/v1' | 'claude-stream-json/v1';
  readonly permissionStrategyId?: 'codex-cli/v1' | 'claude-cli/v1' | 'acp/v1';
  readonly delivery: {
    readonly prompt: 'argument' | 'stdin' | 'file' | 'protocol';
    readonly resultSchema: 'argument' | 'file' | 'protocol';
    readonly result: 'stdout' | 'protocol';
  };
}

type PayloadPreparationResult =
  | Readonly<{ status: 'prepared'; payloads: PreparedInvocationPayloads }>
  | Readonly<{ status: 'rejected' }>;

type PayloadAppendResult = Readonly<{ status: 'appended' }> | Readonly<{ status: 'rejected' }>;

interface PayloadAccumulator {
  readonly argumentsOut: string[];
  readonly files: PreparedPayloadFile[];
  stdin: Uint8Array | undefined;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

const scratchPath = (plan: OutputResourcePlan, leaf: 'prompt.txt' | 'result-schema.json'): string =>
  `${plan.outputDirectory}/.scratch/${leaf}`;

const copyBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes);

const preparedFile = (
  kind: PreparedPayloadFile['kind'],
  path: string,
  bytes: Uint8Array,
): PreparedPayloadFile => Object.freeze({ kind, path, bytes: copyBytes(bytes) });

const maybeFreezeStdin = (stdin: Uint8Array | undefined): { readonly stdin?: Uint8Array } =>
  stdin === undefined ? Object.freeze({}) : Object.freeze({ stdin: copyBytes(stdin) });

const schemaText = (bytes: Uint8Array): string | undefined => {
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
};

const resolvePrompt = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    prompt: string;
  }>,
  argumentsOut: string[],
  files: PreparedPayloadFile[],
): Uint8Array | undefined | 'rejected' => {
  switch (request.binding.delivery.prompt) {
    case 'argument':
      argumentsOut.push(request.prompt);
      return undefined;
    case 'stdin':
      return textEncoder.encode(request.prompt);
    case 'file':
      if (!request.outputResourcePlan.needsPromptFile) return 'rejected';
      files.push(
        preparedFile(
          'prompt',
          scratchPath(request.outputResourcePlan, 'prompt.txt'),
          textEncoder.encode(request.prompt),
        ),
      );
      return undefined;
    case 'protocol':
      return 'rejected';
  }
  return 'rejected';
};

const resolveSchema = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    resultSchemaBytes: Uint8Array;
  }>,
  argumentsOut: string[],
  files: PreparedPayloadFile[],
): boolean => {
  switch (request.binding.delivery.resultSchema) {
    case 'argument': {
      const text = schemaText(request.resultSchemaBytes);
      if (text === undefined) return false;
      argumentsOut.push(text);
      return true;
    }
    case 'file':
      if (!request.outputResourcePlan.needsResultSchemaFile) return false;
      files.push(
        preparedFile(
          'result-schema',
          scratchPath(request.outputResourcePlan, 'result-schema.json'),
          request.resultSchemaBytes,
        ),
      );
      return true;
    case 'protocol':
      return false;
  }
  return false;
};

const appended = (): PayloadAppendResult => Object.freeze({ status: 'appended' });

const rejected = (): PayloadAppendResult => Object.freeze({ status: 'rejected' });

const appendPromptPayload = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    prompt: string;
  }>,
  state: PayloadAccumulator,
): PayloadAppendResult => {
  const payload = resolvePrompt(request, state.argumentsOut, state.files);
  if (payload === 'rejected' || (payload !== undefined && state.stdin !== undefined))
    return rejected();
  if (payload !== undefined) state.stdin = payload;
  return appended();
};

const appendPromptFilePayload = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    prompt: string;
  }>,
  state: PayloadAccumulator,
): PayloadAppendResult => {
  if (request.binding.delivery.prompt !== 'file' || !request.outputResourcePlan.needsPromptFile)
    return rejected();
  state.files.push(
    preparedFile(
      'prompt',
      scratchPath(request.outputResourcePlan, 'prompt.txt'),
      textEncoder.encode(request.prompt),
    ),
  );
  return appended();
};

const appendSchemaPayload = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    resultSchemaBytes: Uint8Array;
  }>,
  state: PayloadAccumulator,
): PayloadAppendResult =>
  resolveSchema(request, state.argumentsOut, state.files) ? appended() : rejected();

const appendSchemaFilePayload = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    resultSchemaBytes: Uint8Array;
  }>,
  state: PayloadAccumulator,
): PayloadAppendResult => {
  if (
    request.binding.delivery.resultSchema !== 'file' ||
    !request.outputResourcePlan.needsResultSchemaFile
  )
    return rejected();
  const path = scratchPath(request.outputResourcePlan, 'result-schema.json');
  state.argumentsOut.push(path);
  state.files.push(preparedFile('result-schema', path, request.resultSchemaBytes));
  return appended();
};

const appendTemplateItemPayload = (
  item: InterpretedArgumentTemplate[number],
  request: Readonly<{
    binding: PayloadPreparationBinding;
    outputResourcePlan: OutputResourcePlan;
    prompt: string;
    resultSchemaBytes: Uint8Array;
  }>,
  state: PayloadAccumulator,
): PayloadAppendResult => {
  switch (item.kind) {
    case 'arguments':
      state.argumentsOut.push(...item.arguments);
      return appended();
    case 'prompt':
      return appendPromptPayload(request, state);
    case 'prompt-file':
      return appendPromptFilePayload(request, state);
    case 'result-schema':
      return appendSchemaPayload(request, state);
    case 'result-schema-file':
      return appendSchemaFilePayload(request, state);
  }
  return rejected();
};

export const prepareInvocationPayloads = (
  request: Readonly<{
    binding: PayloadPreparationBinding;
    interpretedArgumentTemplate: InterpretedArgumentTemplate;
    outputResourcePlan: OutputResourcePlan;
    prompt: string;
    resultSchemaBytes: Uint8Array;
  }>,
): PayloadPreparationResult => {
  if (request.binding.protocolDriverId !== 'native/stdio-v1')
    return Object.freeze({ status: 'rejected' });
  const state: PayloadAccumulator = {
    argumentsOut: [],
    files: [],
    stdin:
      request.binding.delivery.prompt === 'stdin' ? textEncoder.encode(request.prompt) : undefined,
  };
  for (const item of request.interpretedArgumentTemplate) {
    const result = appendTemplateItemPayload(item, request, state);
    if (result.status === 'rejected') return Object.freeze({ status: 'rejected' });
  }
  return Object.freeze({
    status: 'prepared',
    payloads: Object.freeze({
      arguments: Object.freeze(state.argumentsOut),
      ...maybeFreezeStdin(state.stdin),
      files: Object.freeze(state.files),
    }),
  });
};
