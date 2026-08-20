import canonicalize from 'canonicalize';

import type { AgentArgumentTemplate, JsonObject, JsonValue } from '../../spec/index.js';
import type { OutputResourcePlan } from '../output-resource-plan.js';
import type { PermissionStrategyPort } from '../permission-strategy-port/index.js';
import type { WorkspaceAdmissionResult } from '../workspace-admission-result.js';
import type { InterpretedArgumentTemplate } from './interpreted-argument-template.js';

type InterpretedArgumentTemplateItem = InterpretedArgumentTemplate[number];

type TemplateInterpretationResult =
  | Readonly<{ status: 'interpreted'; template: InterpretedArgumentTemplate }>
  | Readonly<{ status: 'rejected' }>;

const renderJsonArgument = (value: JsonValue): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  const rendered = canonicalize(value);
  return rendered === undefined ? undefined : rendered;
};

const ownJsonValue = (source: JsonObject, key: string): JsonValue | undefined =>
  Object.hasOwn(source, key) ? source[key] : undefined;

const interpretedArguments = (args: readonly string[]): InterpretedArgumentTemplateItem =>
  Object.freeze({ kind: 'arguments', arguments: Object.freeze([...args]) });

const interpretParameter = (
  item: Extract<AgentArgumentTemplate, Readonly<{ kind: 'parameter' }>>,
  effectiveParameters: JsonObject,
): InterpretedArgumentTemplateItem | undefined => {
  const value = ownJsonValue(effectiveParameters, item.name);
  if (value === undefined)
    return item.omitIfMissing === true ? interpretedArguments([]) : undefined;
  const rendered = renderJsonArgument(value);
  return rendered === undefined ? undefined : interpretedArguments([rendered]);
};

const interpretPermission = (
  item: Extract<AgentArgumentTemplate, Readonly<{ kind: 'permission' }>>,
  effectivePermissions: JsonObject,
  permissionStrategy: PermissionStrategyPort,
): InterpretedArgumentTemplateItem | undefined => {
  const result = permissionStrategy.map({ item, effectivePermissions });
  if (result.status === 'rejected') return undefined;
  if (result.status === 'omitted') return interpretedArguments([]);
  return interpretedArguments(result.arguments);
};

const interpretItem = (
  item: AgentArgumentTemplate,
  request: Readonly<{
    effectiveParameters: JsonObject;
    effectivePermissions: JsonObject;
    outputResourcePlan: OutputResourcePlan;
    permissionStrategy: PermissionStrategyPort;
    workspace: Extract<WorkspaceAdmissionResult, Readonly<{ status: 'admitted' }>>;
  }>,
): InterpretedArgumentTemplateItem | undefined => {
  switch (item.kind) {
    case 'literal':
      return interpretedArguments([item.value]);
    case 'workspace':
      return interpretedArguments([request.workspace.directory]);
    case 'prompt':
      return Object.freeze({ kind: 'prompt' });
    case 'prompt-file':
      if (!request.outputResourcePlan.needsPromptFile) return undefined;
      return Object.freeze({ kind: 'prompt-file' });
    case 'result-schema':
      return Object.freeze({ kind: 'result-schema' });
    case 'result-schema-file':
      if (!request.outputResourcePlan.needsResultSchemaFile) return undefined;
      return Object.freeze({ kind: 'result-schema-file' });
    case 'parameter':
      return interpretParameter(item, request.effectiveParameters);
    case 'permission':
      return interpretPermission(item, request.effectivePermissions, request.permissionStrategy);
  }
  return undefined;
};

export const interpretArgumentTemplate = (
  request: Readonly<{
    template: readonly AgentArgumentTemplate[];
    effectiveParameters: JsonObject;
    effectivePermissions: JsonObject;
    outputResourcePlan: OutputResourcePlan;
    permissionStrategy: PermissionStrategyPort;
    workspace: Extract<WorkspaceAdmissionResult, Readonly<{ status: 'admitted' }>>;
  }>,
): TemplateInterpretationResult => {
  const interpreted: InterpretedArgumentTemplateItem[] = [];
  for (const item of request.template) {
    const result = interpretItem(item, request);
    if (result === undefined) return Object.freeze({ status: 'rejected' });
    interpreted.push(result);
  }
  return Object.freeze({ status: 'interpreted', template: Object.freeze(interpreted) });
};
