import { Ajv2020 } from 'ajv/dist/2020.js';

export interface ResultSchemaValidator {
  validate(value: unknown): boolean;
}

export const compileResultSchema = (
  schema: Readonly<Record<string, unknown>>,
): ResultSchemaValidator => {
  const compiledValidator = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    coerceTypes: false,
    messages: true,
    ownProperties: true,
    removeAdditional: false,
    strict: true,
    useDefaults: false,
    validateFormats: false,
  }).compile(structuredClone(schema));
  return Object.freeze({ validate: (value: unknown): boolean => compiledValidator(value) });
};
