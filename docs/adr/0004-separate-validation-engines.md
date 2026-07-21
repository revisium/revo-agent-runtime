# ADR-0004: Separate package-input and consumer-schema validation

- Status: Accepted
- Date: 2026-07-21
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md)
- Related specification: [P1 schema profile](../specs/p1-schema-profile.spec.md)

## Context

The manager accepts two materially different validation boundaries. Package-owned
inputs need contracts that align with the package's TypeScript model. A
consumer-supplied result schema is untrusted executable data whose dialect and
resolution must stay deterministic and offline. P1 depth, node, and
canonical-byte limits control resource admission after the existing complete
`inspectPlainJson` pass; they do not promise a hard time or memory bound for
inspecting an arbitrary already-created JavaScript value.

One engine for both boundaries would either weaken package-input ownership or
let consumer-schema concerns determine package DTO validation. Exposing either
engine's types or diagnostics would also couple the package surface to provider
implementation details.

## Decision

Use Zod for package-owned DTO and input-shape validation, and use Ajv in JSON
Schema draft 2020-12 mode for consumer-schema compilation and result-instance
validation. Both engines remain behind package-owned adapters.

The accepted P1 schema profile owns the pre-compilation trust boundary:
resource admission, the closed keyword profile, and local acyclic reference
resolution. Task 3B defines that boundary only. It neither imports nor invokes
Ajv; Ajv compilation, execution, and provider-diagnostic mapping are deferred
to Task 3C.

## Alternatives Considered

- Use Zod for every boundary: keeps one engine, but does not execute the
  consumer's JSON Schema contract directly.
- Use Ajv for every boundary: keeps one engine, but makes package-owned input
  contracts depend on consumer-schema machinery.
- Expose validator-native contracts: reduces adapter work, but couples
  consumers to provider upgrades and unstable diagnostics.
- Allow unrestricted schema resolution and extensions: increases compatibility,
  but weakens deterministic offline validation.

## Consequences

- Each boundary has an engine suited to its purpose while public contracts stay
  provider-neutral.
- The package carries two validation dependencies and must audit them
  independently.
- Consumers may need to simplify schemas to the P1 profile.
- Task 3C must preserve the P1-admitted schema and translate Ajv outcomes into
  package-owned results without widening the public surface.
