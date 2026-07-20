# Internal module structure specification

- Status: Accepted
- Version: 1.0.0
- Accepted: 2026-07-20
- Baseline: PR #4 head `2a6f3d39fccb6661e6b59806a66d88a5f491ad69`
- Related decision: [ADR-0007](../adr/0007-separate-contracts-policy-errors-and-behavior.md)

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`, `REQUIRED`, and `OPTIONAL` in this document are to be
interpreted as described in RFC 2119 and BCP 14.

This specification defines the approved internal structure target. It does not create a package export or claim that the
target structure is present at the baseline commit.

## 1. Scope

The migration MUST be structural only.

The migration MUST preserve observable runtime behavior.

The migration MUST preserve the internal contract shapes and literal values at the baseline, except for the required rename
of the milestone-prefixed fault-code contract to `AgentFaultCode`.

The migration MUST NOT add a Nest dependency.

The migration MUST NOT add another application-framework dependency.

## 2. Current baseline

> **Informative:** PR #4 is titled “M1 Tasks 1-2A: exact dependencies and portable JSON contracts.” Its exact head is the
> commit recorded in the header. At that head, `src/index.ts` exports nothing; the package has no public runtime API.

The baseline modules relevant to this migration are:

```text
src/
├── index.ts
└── runtime/
    ├── definition/
    │   └── plain-json.ts
    └── spec/
        ├── agent-definition.ts
        ├── agent-fault.ts
        ├── agent-probe.ts
        ├── json.ts
        └── manager-options.ts
```

## 3. Target migration

This section is normative for the approved but not-yet-shipped end state.

### 3.1 Required tree

The PR #4 structural refactor MUST produce this exact required tree:

```text
src/
├── index.ts
└── runtime/
    ├── spec/
    │   ├── json/
    │   │   ├── json-primitive.ts
    │   │   ├── json-object-base.ts
    │   │   ├── json-value.ts
    │   │   ├── json-object.ts
    │   │   ├── json-schema-2020-12.ts
    │   │   └── index.ts
    │   ├── agent-definition/
    │   │   ├── agent-ref.ts
    │   │   ├── agent-argument-template.ts
    │   │   ├── agent-version-probe.ts
    │   │   ├── agent-definition-contract.ts
    │   │   ├── agent-definition-input.ts
    │   │   ├── agent-descriptor.ts
    │   │   └── index.ts
    │   ├── agent-fault/
    │   │   ├── agent-validation-diagnostic.ts
    │   │   ├── agent-validation-details.ts
    │   │   ├── agent-fault-code.ts
    │   │   ├── agent-fault.ts
    │   │   └── index.ts
    │   ├── agent-probe/
    │   │   ├── agent-probe-available.ts
    │   │   ├── agent-probe-unavailable.ts
    │   │   ├── agent-probe-result.ts
    │   │   └── index.ts
    │   ├── manager-options/
    │   │   ├── agent-manager-limits.ts
    │   │   ├── agent-manager-options.ts
    │   │   └── index.ts
    │   └── index.ts
    ├── policy/
    │   ├── limits/
    │   │   ├── agent-runtime-limits.ts
    │   │   ├── agent-manager-limits.ts
    │   │   └── index.ts
    │   ├── fault-messages.ts
    │   └── index.ts
    ├── errors/
    │   ├── agent-manager-error.ts
    │   └── index.ts
    └── definition/
        ├── plain-json/
        │   ├── plain-json-inspection.ts
        │   ├── inspect-plain-json.ts
        │   └── index.ts
        └── index.ts
```

`src/runtime/index.ts` MUST NOT exist.

`src/runtime/spec/json/json-object-base.ts` MUST export exactly the domain-internal generic `JsonObjectBase<Value>`.

No barrel MUST re-export `JsonObjectBase<Value>`.

No other production leaf or barrel is part of the PR #4 structural-refactor scope.

### 3.2 Entity ownership

Each target leaf in the following table MUST export exactly the stated entity. A row with a private note describes a symbol
that MUST NOT be re-exported.

| Baseline source            | Target leaf                                          | Entity and migration rule                                                                     |
| -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `spec/json.ts`             | `spec/json/json-primitive.ts`                        | `JsonPrimitive`                                                                               |
| `spec/json.ts`             | `spec/json/json-object-base.ts`                      | `JsonObjectBase<Value>`; domain-internal and never re-exported from a barrel                  |
| `spec/json.ts`             | `spec/json/json-value.ts`                            | `JsonValue`                                                                                   |
| `spec/json.ts`             | `spec/json/json-object.ts`                           | `JsonObject`                                                                                  |
| `spec/json.ts`             | `spec/json/json-schema-2020-12.ts`                   | `JsonSchema202012`                                                                            |
| `spec/json.ts`             | `policy/limits/agent-runtime-limits.ts`              | `AGENT_RUNTIME_LIMITS`                                                                        |
| `spec/agent-definition.ts` | `spec/agent-definition/agent-ref.ts`                 | `AgentRef`                                                                                    |
| `spec/agent-definition.ts` | `spec/agent-definition/agent-argument-template.ts`   | `AgentArgumentTemplate`; its eight anonymous variants remain inline                           |
| `spec/agent-definition.ts` | `spec/agent-definition/agent-version-probe.ts`       | `AgentVersionProbe`                                                                           |
| `spec/agent-definition.ts` | `spec/agent-definition/agent-definition-contract.ts` | `AgentDefinitionContract`                                                                     |
| `spec/agent-definition.ts` | `spec/agent-definition/agent-definition-input.ts`    | `AgentDefinitionInput`; `AgentProtocolInput` becomes a private structural type in this file   |
| `spec/agent-definition.ts` | `spec/agent-definition/agent-descriptor.ts`          | `AgentDescriptor`                                                                             |
| `spec/agent-fault.ts`      | `spec/agent-fault/agent-validation-diagnostic.ts`    | `AgentValidationDiagnostic`                                                                   |
| `spec/agent-fault.ts`      | `spec/agent-fault/agent-validation-details.ts`       | `AgentValidationDetails`                                                                      |
| `spec/agent-fault.ts`      | `spec/agent-fault/agent-fault-code.ts`               | `AgentFaultCode`; replaces the milestone-prefixed fault-code identifier                       |
| `spec/agent-fault.ts`      | `spec/agent-fault/agent-fault.ts`                    | `AgentFault`                                                                                  |
| `spec/agent-fault.ts`      | `policy/fault-messages.ts`                           | `AGENT_FAULT_MESSAGES`                                                                        |
| `spec/agent-fault.ts`      | `errors/agent-manager-error.ts`                      | `AgentManagerError`                                                                           |
| `spec/agent-probe.ts`      | `spec/agent-probe/agent-probe-available.ts`          | `AgentProbeAvailable`                                                                         |
| `spec/agent-probe.ts`      | `spec/agent-probe/agent-probe-unavailable.ts`        | `AgentProbeUnavailable`                                                                       |
| `spec/agent-probe.ts`      | `spec/agent-probe/agent-probe-result.ts`             | `AgentProbeResult`                                                                            |
| `spec/manager-options.ts`  | `spec/manager-options/agent-manager-limits.ts`       | `AgentManagerLimits`                                                                          |
| `spec/manager-options.ts`  | `spec/manager-options/agent-manager-options.ts`      | `AgentManagerOptions`                                                                         |
| `spec/manager-options.ts`  | `policy/limits/agent-manager-limits.ts`              | `AGENT_MANAGER_LIMITS`                                                                        |
| `definition/plain-json.ts` | `definition/plain-json/plain-json-inspection.ts`     | `PlainJsonInspection`                                                                         |
| `definition/plain-json.ts` | `definition/plain-json/inspect-plain-json.ts`        | `inspectPlainJson`; private traversal helpers and private traversal types remain in this file |

`AgentProtocolInput` MUST NOT be exported from its target leaf.

The `AgentArgumentTemplate` variants MUST NOT be promoted to eight named exported entities.

### 3.3 Portable specification layer

Every non-barrel module under `src/runtime/spec` MUST be type-only.

A specification leaf MUST NOT export or declare a runtime value.

A specification leaf MUST NOT import a runtime value.

A specification leaf MUST NOT contain top-level execution.

A specification leaf MUST NOT contain a side effect.

A specification leaf MUST use `import type` for every import.

Compiled ESM output for a specification leaf MAY contain the empty `export {};` module marker.

A specification barrel MUST use only explicit `export type` declarations.

A specification barrel MUST NOT use `export` for a runtime value.

The recursive JSON contracts MUST form an acyclic source-import graph when `import/no-cycle` runs with
`ignoreTypes: false`.

The recursive JSON contracts MUST have one structural definition of JSON-object indexing.

`JsonValue` MUST depend on `JsonObjectBase<Value>`.

`JsonObject` MUST bind `JsonObjectBase<Value>` to `JsonValue` without creating a reverse import.

### 3.4 Policy and errors

`src/runtime/policy` MUST own immutable limits, defaults, and message values.

Each policy leaf MUST export exactly one value.

`AGENT_RUNTIME_LIMITS`, `AGENT_MANAGER_LIMITS`, and `AGENT_FAULT_MESSAGES` MUST retain their baseline values.

The policy layer MUST NOT import the specification layer.

The policy layer MUST NOT import the errors layer.

The policy layer MUST NOT import the definition layer.

`src/runtime/errors/agent-manager-error.ts` MUST own `AgentManagerError`.

The errors layer MAY type-import from the specification layer.

The errors layer MUST NOT import a runtime value from the specification layer.

The errors layer MUST NOT import the policy layer.

The errors layer MUST NOT import the definition layer.

### 3.5 Plain-JSON behavior

`src/runtime/definition/plain-json/inspect-plain-json.ts` MUST own the `inspectPlainJson` implementation.

`src/runtime/definition/plain-json/plain-json-inspection.ts` MUST own the exported `PlainJsonInspection` type.

Private traversal helpers MUST remain in `inspect-plain-json.ts`.

Private traversal-frame and inspected-property types MUST remain in `inspect-plain-json.ts`.

The migration MUST NOT change any accepted or rejected plain-JSON input.

The migration MUST NOT change any produced fault, diagnostic, depth, or node count.

### 3.6 Leaf and barrel rules

Every production leaf MUST export exactly one entity.

A barrel `index.ts` MAY re-export more than one entity.

A private helper MAY remain in the leaf that owns its behavior.

A private structural type MAY remain in the leaf that owns its exported entity.

An inline anonymous union or object variant MUST NOT be promoted merely to create another leaf.

A leaf MUST import another leaf directly when both leaves belong to the same domain.

A module MUST import a domain barrel when it crosses domains within one layer.

A module MUST import a layer barrel when it crosses runtime layers.

A test MUST import a runtime layer barrel.

A leaf MUST NOT import its own domain barrel.

A module under `src/runtime/spec` MUST NOT import `src/runtime/spec/index.ts`.

Every barrel MUST use an explicit named re-export.

No barrel MUST use `export *`.

Every relative TypeScript import or re-export specifier MUST end in `.js`.

The following is a conforming same-domain leaf import:

```ts
import type { AgentFaultCode } from './agent-fault-code.js';
```

The following is a conforming cross-domain import inside the specification layer:

```ts
import type { AgentRef } from '../agent-definition/index.js';
```

The following are conforming cross-layer imports from the definition layer:

```ts
import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES, AGENT_RUNTIME_LIMITS } from '../../policy/index.js';
import type { AgentValidationDiagnostic } from '../../spec/index.js';
```

The following is a conforming domain barrel:

```ts
export type { AgentFault } from './agent-fault.js';
export type { AgentFaultCode } from './agent-fault-code.js';
export type { AgentValidationDetails } from './agent-validation-details.js';
export type { AgentValidationDiagnostic } from './agent-validation-diagnostic.js';
```

The following is a conforming layer barrel:

```ts
export type { AgentFault, AgentFaultCode } from './agent-fault/index.js';
export type { AgentDefinitionContract, AgentRef } from './agent-definition/index.js';
```

The plain-JSON unit test MUST remain at `test/unit/runtime/definition/plain-json.test.ts`.

The plain-JSON unit test MUST import `inspectPlainJson` from
`../../../../src/runtime/definition/index.js`.

The plain-JSON unit test MUST import fault types from `../../../../src/runtime/spec/index.js`.

The plain-JSON unit test MUST import policy values from `../../../../src/runtime/policy/index.js`.

The plain-JSON unit test MUST import `AgentManagerError` from `../../../../src/runtime/errors/index.js`.

### 3.7 Dependency direction

The following diagram is limited to dependencies introduced or exercised by this PR #4 structural split and uses
`importer -> dependency` notation. It does not replace the broader target graph in
[the architecture document](../architecture.md).

```text
definition -> spec
definition -> policy
definition -> errors
errors -> spec
later registry and probe -> definition
application -> later registry and probe
```

The specification and policy layers MUST remain independent of each other.

The errors layer MUST depend on the specification layer only through type imports.

The definition layer MAY import types from specification, values from policy, and `AgentManagerError` from errors.

Later registry and probe layers MAY depend on specification, policy, errors, and definition.

The application layer MAY compose the preceding runtime layers.

This migration MUST NOT add or remove a dependency edge among `runtime/registry`, `runtime/execution`, `strategies`,
`platform`, and `application`. In the broader target, registry and execution remain parallel building blocks; strategies and
platform implement execution ports; application remains the sole composition root.

A dependency MUST NOT point opposite this direction.

A production dependency cycle MUST NOT exist.

### 3.8 Package boundary

`src/index.ts` MUST remain exactly `export {};` during this migration.

`package.json` MUST continue to declare only the root `.` export.

The migration MUST NOT add a public root export.

The migration MUST NOT add a public package subpath.

The migration MUST NOT make an internal source path a supported deep import.

## 4. Architecture enforcement

The architecture verification MUST inspect the type-only nature of every specification leaf.

The architecture verification MUST reject a runtime value exported by a specification leaf.

The architecture verification MUST reject a non-type import in a specification leaf.

The architecture verification MUST inspect every production leaf for the one-export rule.

The architecture verification MUST reject a leaf import of its own barrel.

The architecture verification MUST reject a specification module import of the specification layer barrel.

The architecture verification MUST reject a cross-domain leaf import that bypasses the target domain barrel.

The architecture verification MUST include a negative probe for a cross-domain leaf import that bypasses the target
domain barrel.

The architecture verification MUST reject a cross-layer import that bypasses the target layer barrel.

The architecture verification MUST include a negative probe for a cross-layer import that bypasses the target layer
barrel.

The architecture verification MUST reject `export *` in a production barrel.

The architecture verification MUST reject a relative TypeScript specifier without a `.js` suffix.

Cycle enforcement MUST run with `import/no-cycle` and `ignoreTypes: false`.

The architecture verification MUST include a negative type-cycle probe.

The package verification MUST prove that the root export remains empty.

The package verification MUST prove that package subpath imports are denied.

The package verification MUST prove that source deep imports are denied from the packed consumer.

## 5. Migration sequencing

The PR #4 refactor MUST first establish the specification, policy, errors, and definition barrels without changing the
package root.

The PR #4 refactor MUST then move the baseline entities according to the mapping in section 3.2.

The PR #4 refactor MUST then update the existing plain-JSON test imports and architecture proofs.

Local future work from Tasks 2B through 7B is outside the PR #4 implementation scope.

After the PR #4 refactor lands, each local Task 2B–7B module MUST be rebased onto the new layers without dropping behavior,
tests, diagnostics, bounds, or security properties.

Task 2B diagnostic normalization MUST migrate before consumers of normalized diagnostics.

Tasks 3A–3C schema canonicalization, profile validation, and private compilation MUST preserve their dependency order.

Task 4 version parsing and constraints MUST migrate before later probe consumers.

Task 5 version-output parsing MUST remain in the probe layer.

Task 6 definition identity MUST migrate before registry consumers.

Tasks 7A–7B definition parsing and complete-set validation MUST migrate after their Task 2B–6 dependencies.

Every newly migrated Task 2B–7B exported entity MUST receive one leaf unless it is a barrel.

Every Task 2B–7B private helper or private structural type MUST remain with its behavior owner.

The Task 2B–7B migration MUST NOT widen the PR #4 public package surface.

## 6. Acceptance criteria

The target tree in section 3.1 MUST exist with no additional PR #4 production leaf.

Every barrel-visible entity in section 3.2 MUST resolve through every applicable domain and layer barrel.

`JsonObjectBase<Value>` MUST be available only through a direct same-domain leaf import from `./json-object-base.js`.

`JsonObjectBase<Value>` MUST NOT resolve from any barrel.

For barrel resolution, `AGENT_FAULT_MESSAGES` MUST have only the applicable `src/runtime/policy/index.ts` layer barrel.

For barrel resolution, `AgentManagerError` MUST have only the applicable `src/runtime/errors/index.ts` layer barrel.

A domain barrel MUST NOT be created for `AGENT_FAULT_MESSAGES`.

A domain barrel MUST NOT be created for `AgentManagerError`.

The milestone-prefixed fault-code identifier MUST no longer exist.

`AgentFaultCode` MUST preserve the exact baseline fault-code union.

All baseline plain-JSON unit tests MUST pass without assertion changes.

Typechecking MUST pass with the new direct and barrel imports.

The architecture positive graph MUST pass.

Representative negative probes for type-only leaves, barrels, cycles, root exports, subpaths, and deep imports MUST fail for
the intended rule.

`corepack pnpm format:check` MUST pass.

`corepack pnpm verify` MUST pass before implementation handoff.

## 7. Non-goals

This migration MUST NOT implement Tasks 2B–7B.

This migration MUST NOT change validation semantics.

This migration MUST NOT change fault literals or fault-message literals.

This migration MUST NOT change limits or defaults.

This migration MUST NOT add registry, probe scheduling, or application behavior.

This migration MUST NOT add Nest.

This migration MUST NOT publish the package.
