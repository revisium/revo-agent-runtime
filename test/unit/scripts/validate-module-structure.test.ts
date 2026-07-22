import { expect, test } from 'vitest';

import {
  validateModuleStructure,
  type SourceModule,
} from '../../../scripts/architecture/validate-module-structure.js';

const expectViolation = (module: SourceModule, rule: string): void => {
  expect(() => validateModuleStructure([module])).toThrowError(`[${rule}]`);
};

test('accepts explicit type-only and runtime layer boundaries', () => {
  expect(() =>
    validateModuleStructure([
      {
        path: 'src/runtime/spec/agent-fault/agent-fault.ts',
        source:
          "import type { JsonObject } from '../json/index.js';\nexport interface AgentFault extends JsonObject {}\n",
      },
      {
        path: 'src/runtime/spec/agent-fault/index.ts',
        source: "export type { AgentFault } from './agent-fault.js';\n",
      },
      {
        path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
        source:
          "import type { AgentFault } from '../../spec/index.js';\nexport const inspectPlainJson = (): AgentFault | undefined => undefined;\n",
      },
      {
        path: 'test/unit/runtime/definition/plain-json.test.ts',
        source:
          "import { inspectPlainJson } from '../../../../src/runtime/definition/index.js';\nvoid inspectPlainJson;\n",
      },
    ]),
  ).not.toThrow();
});

test('accepts cohesive type groups in specification leaves', () => {
  expect(() =>
    validateModuleStructure([
      {
        path: 'src/runtime/spec/agent-fault/agent-fault.ts',
        source:
          "export type AgentFaultCode = 'revo.agent.internal';\nexport interface AgentFault { readonly code: AgentFaultCode }\n",
      },
      {
        path: 'src/runtime/spec/agent-fault/agent-validation-diagnostic.ts',
        source:
          'export interface AgentValidationDiagnostic { readonly message: string }\nexport interface AgentValidationDetails { readonly diagnostics: readonly AgentValidationDiagnostic[] }\n',
      },
      {
        path: 'src/runtime/spec/agent-probe/agent-probe-result.ts',
        source:
          "export interface AgentProbeAvailable { readonly status: 'available' }\nexport interface AgentProbeUnavailable { readonly status: 'unavailable' }\nexport type AgentProbeResult = AgentProbeAvailable | AgentProbeUnavailable;\n",
      },
      {
        path: 'src/runtime/spec/manager-options/agent-manager-options.ts',
        source:
          'export interface AgentManagerLimits { readonly timeoutMs?: number }\nexport interface AgentManagerOptions { readonly limits?: AgentManagerLimits }\n',
      },
      {
        path: 'src/runtime/spec/agent-definition/agent-descriptor.ts',
        source:
          'export interface AgentRef { readonly id: string }\nexport interface AgentDescriptor { readonly agent: AgentRef }\n',
      },
      {
        path: 'src/runtime/spec/agent-definition/agent-definition-contract.ts',
        source:
          'export interface AgentDefinitionContract { readonly id: string }\nexport type AgentDefinitionInput = AgentDefinitionContract;\n',
      },
    ]),
  ).not.toThrow();
});

test('accepts the executable probe port cohesive type group', () => {
  expect(() =>
    validateModuleStructure([
      {
        path: 'src/runtime/probe/executable-probe-port/executable-probe-port.ts',
        source:
          "export type ProbeHostPlatform = 'linux';\nexport interface ExecutableProbePort { hostPlatform(): ProbeHostPlatform }\n",
      },
    ]),
  ).not.toThrow();
});

test('rejects runtime syntax in a specification leaf', () => {
  expectViolation(
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source: 'export const jsonValue = true;\n',
    },
    'spec-type-only',
  );
});

test('rejects a non-type import in a specification leaf', () => {
  expectViolation(
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source:
        "import { value } from './json-primitive.js';\nexport type JsonValue = typeof value;\n",
    },
    'spec-type-only',
  );
});

test('counts every exported name in a destructured binding', () => {
  expectViolation(
    {
      path: 'src/runtime/policy/destructured.ts',
      source: 'export const { first, nested: { second } } = source;\n',
    },
    'one-export-per-leaf',
  );
});

test('rejects a specification leaf re-export from its own barrel', () => {
  expectViolation(
    {
      path: 'src/runtime/spec/json/json-value.ts',
      source: "export type { JsonPrimitive } from './index.js';\n",
    },
    'own-barrel-import',
  );
});

test('rejects a dynamic cross-layer deep import', () => {
  expectViolation(
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "export const loadLimits = () => import('../../policy/limits/agent-runtime-limits.js');\n",
    },
    'cross-layer-barrel-import',
  );
});

test('rejects a test dynamic import of a runtime domain barrel', () => {
  expectViolation(
    {
      path: 'test/unit/runtime/definition/plain-json.test.ts',
      source: "void import('../../../../src/runtime/definition/plain-json/index.js');\n",
    },
    'test-layer-barrel-import',
  );
});

test('rejects a dynamic import whose target cannot be checked statically', () => {
  expectViolation(
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "const target = '../../policy/limits/agent-runtime-limits.js';\nexport const loadLimits = () => import(target);\n",
    },
    'relative-js-suffix',
  );
});

test('rejects a cross-layer import-equals dependency', () => {
  expectViolation(
    {
      path: 'src/runtime/definition/plain-json/inspect-plain-json.ts',
      source:
        "import limits = require('../../policy/limits/agent-runtime-limits.js');\nexport const inspectPlainJson = limits;\n",
    },
    'cross-layer-barrel-import',
  );
});

test('rejects a cross-layer import type dependency', () => {
  expectViolation(
    {
      path: 'src/runtime/definition/plain-json/plain-json-inspection.ts',
      source:
        "export type PlainJsonInspection = import('../../policy/limits/agent-runtime-limits.js').AGENT_RUNTIME_LIMITS;\n",
    },
    'cross-layer-barrel-import',
  );
});

test.each([
  [
    'one-export-per-leaf',
    'src/runtime/policy/fault-messages.ts',
    'export const first = true;\nexport const second = true;\n',
  ],
  [
    'explicit-barrel-exports',
    'src/runtime/spec/json/index.ts',
    "export * from './json-value.js';\n",
  ],
  [
    'relative-js-suffix',
    'src/runtime/spec/json/json-value.ts',
    "import type { JsonPrimitive } from './json-primitive';\nexport type JsonValue = JsonPrimitive;\n",
  ],
  [
    'own-barrel-import',
    'src/runtime/spec/json/json-value.ts',
    "import type { JsonPrimitive } from './index.js';\nexport type JsonValue = JsonPrimitive;\n",
  ],
  [
    'spec-layer-barrel-import',
    'src/runtime/spec/json/json-value.ts',
    "import type { JsonPrimitive } from '../index.js';\nexport type JsonValue = JsonPrimitive;\n",
  ],
  [
    'cross-domain-barrel-import',
    'src/runtime/spec/agent-fault/agent-fault.ts',
    "import type { AgentRef } from '../agent-definition/agent-descriptor.js';\nexport interface AgentFault { readonly agent: AgentRef }\n",
  ],
  [
    'cross-layer-barrel-import',
    'src/runtime/definition/plain-json/inspect-plain-json.ts',
    "import { AGENT_RUNTIME_LIMITS } from '../../policy/limits/agent-runtime-limits.js';\nexport const inspectPlainJson = AGENT_RUNTIME_LIMITS;\n",
  ],
  [
    'test-layer-barrel-import',
    'test/unit/runtime/definition/plain-json.test.ts',
    "import { inspectPlainJson } from '../../../../src/runtime/definition/plain-json/index.js';\nvoid inspectPlainJson;\n",
  ],
  [
    'json-object-base-private',
    'src/runtime/spec/json/index.ts',
    "export type { JsonObjectBase } from './json-object-base.js';\n",
  ],
] as const)('rejects %s violations', (rule, path, source) => {
  expectViolation({ path, source }, rule);
});
