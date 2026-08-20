import type {
  PermissionMappingResult,
  PermissionStrategyPort,
} from '../../../runtime/execution/index.js';
import type { JsonObject, JsonValue } from '../../../runtime/spec/index.js';
import { mapCodexPermissions } from './codex-permission-strategy.js';

type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

type CodexNetwork = 'disabled' | 'enabled';

type PermissionMapRequest = Parameters<PermissionStrategyPort['map']>[0];

interface CodexPermissionRequestShape {
  readonly sandbox: CodexSandbox;
  readonly network: CodexNetwork;
  readonly allowDangerFullAccess?: boolean;
}

const permissionMissing = (): PermissionMappingResult =>
  Object.freeze({ status: 'rejected', reason: 'permission_missing' });

const permissionInvalid = (): PermissionMappingResult =>
  Object.freeze({ status: 'rejected', reason: 'permission_invalid' });

const permissionDenied = (): PermissionMappingResult =>
  Object.freeze({ status: 'rejected', reason: 'permission_denied' });

const isCodexSandbox = (value: JsonValue | undefined): value is CodexSandbox =>
  value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access';

const readOwn = (source: JsonObject, key: string): JsonValue | undefined =>
  Object.hasOwn(source, key) ? source[key] : undefined;

const codexNetwork = (value: JsonValue | undefined): CodexNetwork | undefined => {
  if (value === true) return 'enabled';
  if (value === false) return 'disabled';
  return undefined;
};

const codexRequest = (
  effectivePermissions: JsonObject,
): CodexPermissionRequestShape | undefined => {
  const sandbox = readOwn(effectivePermissions, 'mode');
  const network = readOwn(effectivePermissions, 'network');
  const allowDangerFullAccess = readOwn(effectivePermissions, 'allowDangerFullAccess');
  if (sandbox === undefined || network === undefined) return undefined;
  if (!isCodexSandbox(sandbox)) return undefined;
  const mappedNetwork = codexNetwork(network);
  if (mappedNetwork === undefined) return undefined;
  if (allowDangerFullAccess !== undefined && typeof allowDangerFullAccess !== 'boolean')
    return undefined;
  return Object.freeze({
    sandbox,
    network: mappedNetwork,
    ...(allowDangerFullAccess === undefined ? {} : { allowDangerFullAccess }),
  });
};

const argumentsFor = (
  name: string,
  request: CodexPermissionRequestShape,
): readonly string[] | undefined => {
  const mapped = mapCodexPermissions(request);
  if (name === 'mode') return Object.freeze([mapped.sandboxFlag, mapped.approvalFlag]);
  if (name === 'network') return mapped.config;
  return undefined;
};

export const CodexPermissionStrategy: PermissionStrategyPort = Object.freeze({
  id: 'codex-cli/v1',
  map: (mapRequest: PermissionMapRequest) => {
    const { item, effectivePermissions } = mapRequest;
    if (readOwn(effectivePermissions, item.name) === undefined)
      return item.omitIfMissing === true
        ? Object.freeze({ status: 'omitted' })
        : permissionMissing();
    const codexPermissionRequest = codexRequest(effectivePermissions);
    if (codexPermissionRequest === undefined) return permissionInvalid();
    try {
      const mappedArguments = argumentsFor(item.name, codexPermissionRequest);
      return mappedArguments === undefined
        ? permissionInvalid()
        : Object.freeze({ status: 'mapped', arguments: Object.freeze([...mappedArguments]) });
    } catch {
      return permissionDenied();
    }
  },
});
