import type { JsonValue } from '../../spec/index.js';
import { isJsonArray } from './is-json-array.js';

export const freezeJsonValue = (value: JsonValue): void => {
  if (value === null || typeof value !== 'object') return;

  if (isJsonArray(value)) {
    for (const item of value) freezeJsonValue(item);
  } else {
    for (const item of Object.values(value)) freezeJsonValue(item);
  }

  Object.freeze(value);
};
