import Ajv2020 from 'ajv/dist/2020.js';

import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../policy/index.js';
import type {
  AgentFault,
  AgentValidationDetails,
  JsonSchema202012,
  JsonValue,
} from '../../spec/index.js';
import {
  normalizeValidationDiagnostics,
  type ValidationDiagnosticInput,
} from '../validation-diagnostics/index.js';
import type { CompiledConsumerSchema } from './compiled-consumer-schema.js';

const diagnosticTemplates = Object.freeze({
  additionalProperties: Object.freeze({
    keyword: 'additionalProperties',
    message: 'Object must not contain additional properties.',
  }),
  const: Object.freeze({ keyword: 'const', message: 'Value must equal the schema constant.' }),
  enum: Object.freeze({
    keyword: 'enum',
    message: 'Value must equal one of the allowed schema values.',
  }),
  exclusiveMaximum: Object.freeze({
    keyword: 'exclusiveMaximum',
    message: 'Number must be less than the exclusive maximum.',
  }),
  exclusiveMinimum: Object.freeze({
    keyword: 'exclusiveMinimum',
    message: 'Number must be greater than the exclusive minimum.',
  }),
  falseSchema: Object.freeze({
    keyword: 'false_schema',
    message: 'Value is rejected by the schema.',
  }),
  maximum: Object.freeze({ keyword: 'maximum', message: 'Number exceeds the allowed maximum.' }),
  maxItems: Object.freeze({
    keyword: 'maxItems',
    message: 'Array contains more items than allowed.',
  }),
  maxLength: Object.freeze({
    keyword: 'maxLength',
    message: 'String contains more characters than allowed.',
  }),
  minimum: Object.freeze({ keyword: 'minimum', message: 'Number is below the allowed minimum.' }),
  minItems: Object.freeze({
    keyword: 'minItems',
    message: 'Array contains fewer items than required.',
  }),
  minLength: Object.freeze({
    keyword: 'minLength',
    message: 'String contains fewer characters than required.',
  }),
  multipleOf: Object.freeze({
    keyword: 'multipleOf',
    message: 'Number must be a multiple of the schema value.',
  }),
  required: Object.freeze({
    keyword: 'required',
    message: 'Object is missing a required property.',
  }),
  schemaCompile: Object.freeze({
    keyword: 'schema_compile',
    message: 'Schema could not be compiled.',
  }),
  schemaMismatch: Object.freeze({
    keyword: 'schema_mismatch',
    message: 'Value does not satisfy the schema.',
  }),
  type: Object.freeze({ keyword: 'type', message: 'Value does not match the schema type.' }),
  uniqueItems: Object.freeze({ keyword: 'uniqueItems', message: 'Array items must be unique.' }),
});

type DiagnosticTemplate = (typeof diagnosticTemplates)[keyof typeof diagnosticTemplates];

type AjvDiagnostic = {
  readonly instancePath: string;
  readonly keyword: string;
  readonly schemaPath: string;
};

type AjvValidator = {
  (value: JsonValue): boolean;
  readonly errors: readonly AjvDiagnostic[] | null | undefined;
};

type Ajv2020Instance = {
  compile(schema: JsonSchema202012): AjvValidator;
};

type Ajv2020Constructor = new (options: {
  readonly strict: boolean;
  readonly allowUnionTypes: boolean;
  readonly allErrors: boolean;
  readonly coerceTypes: boolean;
  readonly useDefaults: boolean;
  readonly removeAdditional: boolean;
  readonly validateFormats: boolean;
  readonly ownProperties: boolean;
  readonly messages: boolean;
}) => Ajv2020Instance;

const isAjv2020Constructor = (value: unknown): value is Ajv2020Constructor =>
  typeof value === 'function';

const resolveAjv2020Constructor = (): Ajv2020Constructor => {
  const candidate: unknown = Ajv2020;
  if (!isAjv2020Constructor(candidate)) throw new Error('Ajv 2020 constructor is unavailable.');

  return candidate;
};

const createAjv = (): Ajv2020Instance =>
  new (resolveAjv2020Constructor())({
    strict: true,
    allowUnionTypes: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
    validateFormats: false,
    ownProperties: true,
    messages: true,
  });

const compilationFault = (schemaInstancePath: string): AgentFault => ({
  code: 'revo.agent.definition_invalid',
  message: AGENT_FAULT_MESSAGES.definitionInvalid,
  phase: 'construction',
  retryable: false,
  details: normalizeValidationDiagnostics([
    {
      instancePath: schemaInstancePath,
      schemaPath: '/schema_compile',
      ...diagnosticTemplates.schemaCompile,
    },
  ]),
});

const compileSchema = (schema: JsonSchema202012, schemaInstancePath: string) => {
  try {
    return createAjv().compile(schema);
  } catch {
    throw new AgentManagerError(compilationFault(schemaInstancePath));
  }
};

const qualifyInstancePath = (basePath: string, ajvPath: string): string => {
  if (ajvPath.length === 0) return basePath;
  if (basePath.length === 0 || basePath === '/') return ajvPath;
  return `${basePath}${ajvPath}`;
};

const diagnosticTemplateFor = (keyword: string): DiagnosticTemplate => {
  switch (keyword) {
    case 'additionalProperties':
      return diagnosticTemplates.additionalProperties;
    case 'const':
      return diagnosticTemplates.const;
    case 'enum':
      return diagnosticTemplates.enum;
    case 'exclusiveMaximum':
      return diagnosticTemplates.exclusiveMaximum;
    case 'exclusiveMinimum':
      return diagnosticTemplates.exclusiveMinimum;
    case 'false schema':
      return diagnosticTemplates.falseSchema;
    case 'maximum':
      return diagnosticTemplates.maximum;
    case 'maxItems':
      return diagnosticTemplates.maxItems;
    case 'maxLength':
      return diagnosticTemplates.maxLength;
    case 'minimum':
      return diagnosticTemplates.minimum;
    case 'minItems':
      return diagnosticTemplates.minItems;
    case 'minLength':
      return diagnosticTemplates.minLength;
    case 'multipleOf':
      return diagnosticTemplates.multipleOf;
    case 'required':
      return diagnosticTemplates.required;
    case 'type':
      return diagnosticTemplates.type;
    case 'uniqueItems':
      return diagnosticTemplates.uniqueItems;
    default:
      return diagnosticTemplates.schemaMismatch;
  }
};

const packageSchemaPath = (schemaPath: string): string => {
  if (schemaPath === '#') return '';
  if (schemaPath.startsWith('#/')) return schemaPath.slice(1);
  return '/schema_mismatch';
};

const copyValidationDiagnostic = (
  error: AjvDiagnostic,
  valueInstancePath: string,
): ValidationDiagnosticInput => ({
  instancePath: qualifyInstancePath(valueInstancePath, error.instancePath),
  schemaPath: packageSchemaPath(error.schemaPath),
  ...diagnosticTemplateFor(error.keyword),
});

const evaluateSchema = (
  validator: AjvValidator,
  value: JsonValue,
  valueInstancePath: string,
): AgentValidationDetails | undefined => {
  if (validator(value)) return undefined;

  const errors = validator.errors;
  const inputs =
    errors === null || errors === undefined || errors.length === 0
      ? [
          {
            instancePath: valueInstancePath,
            schemaPath: '/schema_mismatch',
            ...diagnosticTemplates.schemaMismatch,
          },
        ]
      : errors.map((error) => copyValidationDiagnostic(error, valueInstancePath));

  return normalizeValidationDiagnostics(inputs);
};

export const compileConsumerSchema = (
  schema: JsonSchema202012,
  schemaInstancePath: string,
): CompiledConsumerSchema => {
  const validator = compileSchema(schema, schemaInstancePath);

  return Object.freeze({
    validate: (value: JsonValue, valueInstancePath: string): AgentValidationDetails | undefined =>
      evaluateSchema(validator, value, valueInstancePath),
  });
};
