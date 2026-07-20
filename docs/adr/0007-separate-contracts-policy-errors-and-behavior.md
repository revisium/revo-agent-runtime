# ADR-0007: Separate contracts, policy, errors, and behavior

- Status: Accepted
- Date: 2026-07-20
- Related specification: [Internal module structure](../specs/internal-module-structure.spec.md)

## Context

The first internal milestone placed portable contracts, fixed policy values, an error class, and plain-JSON behavior in a
small number of mixed modules. That was sufficient to establish behavior, but it blurred dependency direction and made a
file name an unreliable guide to whether importing it would add runtime code.

The package needs a structure that keeps durable provider-neutral types portable, makes runtime policy and behavior
explicit, prevents circular type dependencies, and scales into registry, probing, and application layers. It must do this
without publishing the still-internal milestone surface or changing its behavior.

## Decision

Separate portable contracts, immutable policy values, typed errors, and behavior into distinct layers. The portable
contract layer is a strictly type-only dependency leaf. Policy is independently importable runtime data. Errors depend on
contract types, and behavior depends on contracts, policy, and errors.

Use one exported entity per leaf module, with explicit two-level barrels at domain and layer boundaries. Barrel modules and
private helpers or structural types owned by one behavior are the only exceptions. Anonymous variants remain part of their
owning exported union instead of becoming artificial exported entities.

Keep the package root empty and add no runtime root barrel, package subpath, or public deep-import path. Rename the
milestone-prefixed fault-code contract to its durable role-based name. The exact structure, import rules, and migration
mapping are normative in the related specification.

## Alternatives Considered

- **Keep the mixed specification modules:** minimizes immediate file movement, but continues to mix runtime values and
  behavior with portable types and weakens dependency enforcement.
- **Rename the specification area to contracts:** describes its contents, but creates broad naming churn without improving
  the separation; the established specification term remains clear once the area is type-only.
- **Create global types, constants, and functions areas:** groups code by language construct, but separates behavior from
  its domain and encourages unrelated dependencies through broad shared barrels.

## Consequences

- Portable contracts can be checked as a type-only acyclic leaf, while policy, errors, and behavior have visible ownership.
- Direct leaf imports inside a domain and controlled barrels across boundaries make dependencies reviewable and
  mechanically enforceable.
- More files and explicit re-exports add navigation and maintenance overhead.
- The structural migration must preserve every existing contract and behavior while updating imports and architecture
  proofs; later milestone work must adopt the same rule without being folded into the initial refactor.
- No Nest or other application-framework dependency is introduced.
