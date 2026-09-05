import { Ajv2020 } from 'ajv/dist/2020.js';

import type { JsonObject, JsonValue } from '../../contracts/agent-definition.js';
import type { ValidatedAgentDefinition } from '../../definition/index.js';
import { snapshotPlainJsonObject } from '../../execution/output/plain-json-snapshot.js';

interface EffectiveInputValidators {
  readonly parameters: (value: JsonObject) => boolean;
  readonly permissions: (value: JsonObject) => boolean;
}

export interface EffectiveInvocationInputs {
  readonly parameters: JsonObject;
  readonly permissions: JsonObject;
}

export type EffectiveInvocationInputPreparation =
  | Readonly<{ readonly status: 'parameters_invalid' }>
  | Readonly<{ readonly status: 'permissions_invalid' }>
  | Readonly<{ readonly status: 'prepared'; readonly inputs: EffectiveInvocationInputs }>;

const compileValidator = (schema: JsonObject): ((value: JsonObject) => boolean) => {
  const validator = new Ajv2020({
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
  return (value: JsonObject): boolean => validator(value);
};

const compileValidators = (definition: ValidatedAgentDefinition): EffectiveInputValidators => {
  const { parameters, permissions } = definition.definition;
  return Object.freeze({
    parameters: compileValidator(parameters.schema),
    permissions: compileValidator(permissions.schema),
  });
};

const overlayTopLevelDefaults = (
  defaults: JsonObject | undefined,
  caller: JsonObject,
): JsonObject => {
  const effective: Record<string, JsonValue> = {};
  Object.setPrototypeOf(effective, null);
  const replace = (key: string, value: JsonValue): void => {
    Object.defineProperty(effective, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  };
  for (const [key, value] of Object.entries(defaults ?? {})) replace(key, value);
  for (const [key, value] of Object.entries(caller)) replace(key, value);
  return Object.freeze(effective);
};

export class EffectiveInvocationInputPolicy {
  private readonly validators: ReadonlyMap<ValidatedAgentDefinition, EffectiveInputValidators>;

  private constructor(definitions: readonly ValidatedAgentDefinition[]) {
    this.validators = new Map(
      definitions.map((definition) => [definition, compileValidators(definition)]),
    );
  }

  static create(definitions: readonly ValidatedAgentDefinition[]): EffectiveInvocationInputPolicy {
    const policy = new EffectiveInvocationInputPolicy(definitions);
    Object.freeze(policy);
    return policy;
  }

  prepare(
    definition: ValidatedAgentDefinition,
    caller: Readonly<{
      readonly parameters: Readonly<Record<string, unknown>>;
      readonly permissions: Readonly<Record<string, unknown>>;
    }>,
  ): EffectiveInvocationInputPreparation {
    const validators = this.validators.get(definition)!;
    const parameters = overlayTopLevelDefaults(
      definition.definition.parameters.defaults,
      snapshotPlainJsonObject(caller.parameters, 262_144),
    );
    if (!validators.parameters(parameters)) return Object.freeze({ status: 'parameters_invalid' });
    const permissions = overlayTopLevelDefaults(
      definition.definition.permissions.defaults,
      snapshotPlainJsonObject(caller.permissions, 262_144),
    );
    if (!validators.permissions(permissions))
      return Object.freeze({ status: 'permissions_invalid' });
    return Object.freeze({
      inputs: Object.freeze({ parameters, permissions }),
      status: 'prepared',
    });
  }
}
