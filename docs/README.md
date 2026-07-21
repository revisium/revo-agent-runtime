# Documentation

## Target contract

- [AgentManager v1 specification](./specs/agent-manager-v1.spec.md) — normative draft public API, lifecycle, shutdown,
  results, events, files, bounds, errors, and invariants. It is not implemented yet.
- [Internal module structure specification](./specs/internal-module-structure.spec.md) — accepted internal ownership,
  layering, barrels, and architecture-enforcement rules. It does not add a package export.
- [Internal definition canonical-byte adapter specification](./specs/definition-canonical-bytes.spec.md) — accepted target
  for the private RFC 8785 canonical-byte boundary; it does not add a package export or describe shipped behavior.
- [P1 schema profile specification](./specs/p1-schema-profile.spec.md) — accepted target for bounded consumer-schema
  profile admission and local reference validation; it does not compile schemas or describe shipped behavior.
- [Architecture](./architecture.md) — target folders, file responsibilities, dependency direction, and ownership boundary.
- [Testing](./testing.md) — proof layers, architecture/package gates, and implementation test requirements.
- [Expanded consumer example](./examples/consumer.md) — complete target Codex definition and invocation setup.

## Decisions

- [ADR-0001](./adr/0001-agent-runtime-boundary.md) — extract an attempt-scoped agent runtime.
- [ADR-0002](./adr/0002-agent-manager-consumer-boundary.md) — add a sealed process-local AgentManager consumer and shutdown
  boundary.
- [ADR-0003](./adr/0003-invocation-output-recording.md) — record invocation-local output in the exact consumer directory.
- [ADR-0004](./adr/0004-separate-validation-engines.md) — separate package-input and consumer-schema validation.
- [ADR-0005](./adr/0005-audited-jcs-definition-identity.md) — use an audited RFC 8785 provider for definition-identity
  canonical bytes.
- [ADR-0007](./adr/0007-separate-contracts-policy-errors-and-behavior.md) — separate portable contracts, immutable policy,
  typed errors, and behavior behind explicit internal barrels.

## Repository policy

- [Repository contract](../REPOSITORY.md) — source-of-truth order and dependency rules.
- [Verification contract](../VERIFICATION.md) — executable local and remote quality gates.
- [Review contract](../REVIEW.md) — blocking review conditions and expected evidence.

The repository is in bootstrap. Target documents do not create a public API. Only implemented source, tests, declarations,
and declared package exports describe available runtime behavior.
