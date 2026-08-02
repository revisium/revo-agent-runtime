import type { JsonValue } from '../../spec/index.js';

export const isJsonArray = (value: JsonValue): value is readonly JsonValue[] =>
  Array.isArray(value);
