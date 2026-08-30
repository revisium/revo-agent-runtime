# Documentation

## Target contract

- [AgentManager v1 specification](./specs/agent-manager-v1.spec.md) — normative draft public API, initialization, local
  process recovery, lifecycle, shutdown, results, events, files, bounds, errors, and invariants. The implementation
  root-exports its provider-neutral manager surface.
- [Internal module structure specification](./specs/internal-module-structure.spec.md) — accepted internal ownership,
  layering, barrels, and architecture-enforcement rules. It does not add a package export.
- [B+ execution handoff specification](./specs/execution-handoff.spec.md) — accepted package-private target for sealed
  preparation, preregistered ownership, paused-I/O supervision, and terminal publication. The implementation provides it
  behind the provider-neutral root API; it adds no provider-specific public surface.
- [Internal definition canonical-byte adapter specification](./specs/definition-canonical-bytes.spec.md) — accepted target
  for the private RFC 8785 canonical-byte boundary; it does not add a package export or describe shipped behavior.
- [Consumer-schema profile specification](./specs/consumer-schema-profile.spec.md) — accepted target for bounded consumer-schema
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
- [ADR-0006](./adr/0006-consumer-backed-active-invocation-recovery.md) — reconcile consumer-backed active invocation rows and
  safely clean up non-reconnectable local processes after restart.
- [ADR-0007](./adr/0007-separate-contracts-policy-errors-and-behavior.md) — separate portable contracts, immutable policy,
  typed errors, and behavior behind explicit internal barrels.
- [ADR-0008](./adr/0008-real-mechanics-supervision-boundary.md) — refine private multi-invocation process supervision,
  fresh launch evidence, and lifecycle-only event ownership.
- [ADR-0009](./adr/0009-process-signal-authority.md) — separate persisted-row correlation from authority to signal a
  process and record the Option A pre-acceptance lifecycle.
- [ADR-0010](./adr/0010-consumer-warranted-stable-output-ancestors.md) — require a consumer-provisioned output hierarchy and
  trusted stable ancestors through terminal filesystem quiescence.
- [ADR-0011](./adr/0011-consumer-governed-local-supervision.md) — define consumer-governed admission, synchronous listener
  ownership, workspace authorization, and authoritative local supervision.
- [ADR-0012](./adr/0012-public-agentmanager-after-first-adapter.md) — permit the provider-neutral public AgentManager only
  after the frozen real-process harness and first supported adapter pass their separate gates.
- [ADR-0013](./adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md) — adopt B+ sealed intent,
  preregistered capability-bound execution, paused-I/O acceptance, and one terminal authority.

## Repository policy

- [Repository contract](../REPOSITORY.md) — source-of-truth order and dependency rules.
- [Verification contract](../VERIFICATION.md) — executable local and remote quality gates.
- [Review contract](../REVIEW.md) — blocking review conditions and expected evidence.

The root package export contains the curated provider-neutral AgentManager API. Internal strategy, registry, execution, and
testing modules remain private. Only implemented source, tests, declarations, and declared package exports describe
available runtime behavior.
