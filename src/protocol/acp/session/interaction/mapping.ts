import type * as acp from '@agentclientprotocol/sdk';

import type {
  SessionProtocolInteractionRequest,
  SessionProtocolQuestion,
} from '../../../session/model/update.js';

const title = (value: string | null | undefined, fallback: string): string => value ?? fallback;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const stringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
    ? value
    : undefined;

const enumOptions = (value: unknown): readonly acp.EnumOption[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const options: acp.EnumOption[] = [];
  const items: readonly unknown[] = value;
  for (const item of items) {
    if (!isRecord(item) || typeof item.const !== 'string' || typeof item.title !== 'string')
      return undefined;
    options.push({ const: item.const, title: item.title });
  }
  return options;
};

const optionsFrom = (
  values: readonly string[] | null | undefined,
  titled: readonly acp.EnumOption[] | null | undefined,
) =>
  Object.freeze(
    titled?.map(({ const: optionId, title: label }) => Object.freeze({ label, optionId })) ??
      values?.map((optionId) => Object.freeze({ label: optionId, optionId })) ??
      [],
  );

type QuestionCommon = Readonly<{
  questionId: string;
  required: boolean;
  title: string;
}>;

const stringQuestion = (
  common: QuestionCommon,
  schema: Readonly<Record<string, unknown>>,
): SessionProtocolQuestion => {
  const options = optionsFrom(stringArray(schema.enum), enumOptions(schema.oneOf));
  if (options.length > 0)
    return Object.freeze({
      ...common,
      allowOther: false,
      input: 'select',
      options,
      selection: 'single',
    });
  const maximum = optionalNumber(schema.maxLength) ?? 65_536;
  const minimum = optionalNumber(schema.minLength);
  return Object.freeze({
    ...common,
    input: 'text',
    maxLength: maximum,
    ...(minimum === undefined ? {} : { minLength: minimum }),
    multiline: false,
  });
};

const numberQuestion = (
  common: QuestionCommon,
  schema: Readonly<Record<string, unknown>>,
): SessionProtocolQuestion => {
  const maximum = optionalNumber(schema.maximum);
  const minimum = optionalNumber(schema.minimum);
  return Object.freeze({
    ...common,
    input: 'number',
    integer: schema.type === 'integer',
    ...(maximum === undefined ? {} : { maximum }),
    ...(minimum === undefined ? {} : { minimum }),
  });
};

const arrayOptions = (
  items: Readonly<Record<string, unknown>>,
): readonly Readonly<{ label: string; optionId: string }>[] => {
  if ('anyOf' in items) return optionsFrom(undefined, enumOptions(items.anyOf));
  if ('enum' in items) return optionsFrom(stringArray(items.enum), undefined);
  return [];
};

const arrayQuestion = (
  common: QuestionCommon,
  schema: Readonly<Record<string, unknown>>,
): SessionProtocolQuestion | undefined => {
  const items = schema.items;
  if (!isRecord(items)) return undefined;
  const options = arrayOptions(items);
  if (options.length === 0) return undefined;
  return Object.freeze({
    ...common,
    allowOther: false,
    input: 'select',
    options,
    selection: 'multiple',
  });
};

const question = (
  questionId: string,
  schema: Readonly<Record<string, unknown>>,
  required: boolean,
): SessionProtocolQuestion | undefined => {
  const common = {
    questionId,
    required,
    title: title(optionalString(schema.title), questionId),
  };
  if (schema.type === 'string') return stringQuestion(common, schema);
  if (schema.type === 'number' || schema.type === 'integer') return numberQuestion(common, schema);
  if (schema.type === 'boolean') return Object.freeze({ ...common, input: 'boolean' });
  if (schema.type === 'array') return arrayQuestion(common, schema);
  return undefined;
};

export const mapAcpPermissionRequest = (
  requestId: string,
  request: acp.RequestPermissionRequest,
): SessionProtocolInteractionRequest => {
  const actionTitle = request.toolCall.title;
  return Object.freeze({
    action: Object.freeze({
      kind: request.toolCall.kind ?? 'other',
      ...(actionTitle == null ? {} : { title: actionTitle }),
    }),
    kind: 'permission',
    options: Object.freeze(
      request.options.map((option) =>
        Object.freeze({ kind: option.kind, label: option.name, optionId: option.optionId }),
      ),
    ),
    requestId,
  });
};

export const mapAcpElicitationRequest = (
  requestId: string,
  request: acp.CreateElicitationRequest,
): SessionProtocolInteractionRequest | undefined => {
  if (request.mode !== 'form' || !isRecord(request.requestedSchema)) return undefined;
  const properties = request.requestedSchema.properties;
  if (properties !== undefined && !isRecord(properties)) return undefined;
  const required = new Set(stringArray(request.requestedSchema.required) ?? []);
  const questions: SessionProtocolQuestion[] = [];
  for (const [questionId, schema] of Object.entries(properties ?? {})) {
    if (!isRecord(schema) || typeof schema.type !== 'string') return undefined;
    const mapped = question(questionId, schema, required.has(questionId));
    if (mapped === undefined) return undefined;
    questions.push(mapped);
  }
  return Object.freeze({
    kind: 'input',
    message: request.message,
    questions: Object.freeze(questions),
    requestId,
  });
};
