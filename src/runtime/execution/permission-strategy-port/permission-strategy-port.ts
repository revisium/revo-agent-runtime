import type {
  AgentArgumentTemplate,
  AgentDefinitionContract,
  JsonObject,
} from '../../spec/index.js';
import type { PermissionMappingResult } from './permission-mapping-result.js';

export interface PermissionStrategyPort {
  readonly id: AgentDefinitionContract['protocol']['permissionStrategy'];
  map(
    request: Readonly<{
      item: Extract<AgentArgumentTemplate, Readonly<{ kind: 'permission' }>>;
      effectivePermissions: JsonObject;
    }>,
  ): PermissionMappingResult;
}
