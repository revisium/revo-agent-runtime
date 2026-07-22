import type { JsonObject } from '../../spec/index.js';

export interface DefinitionIdentity {
  readonly digest: string;
  readonly snapshot: JsonObject;
}
