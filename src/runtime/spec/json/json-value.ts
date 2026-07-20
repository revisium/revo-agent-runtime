import type { JsonObjectBase } from './json-object-base.js';
import type { JsonPrimitive } from './json-primitive.js';

export type JsonValue = JsonPrimitive | JsonObjectBase<JsonValue> | readonly JsonValue[];
