import type { z } from 'zod/v4';

import type { rawAgentDefinitionSchema } from './raw-agent-definition-schema.js';

type ReadonlyJson<Value> = Value extends readonly unknown[]
  ? number extends Value['length']
    ? readonly ReadonlyJson<Value[number]>[]
    : { readonly [Key in keyof Value]: ReadonlyJson<Value[Key]> }
  : Value extends object
    ? string extends keyof Value
      ? Value
      : { readonly [Key in keyof Value]: ReadonlyJson<Value[Key]> }
    : Value;

export type RawAgentDefinition = ReadonlyJson<z.infer<typeof rawAgentDefinitionSchema>>;
