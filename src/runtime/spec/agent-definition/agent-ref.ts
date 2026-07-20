import type { JsonObject } from '../json/index.js';

export interface AgentRef extends JsonObject {
  readonly id: string;
  readonly version: string;
}
