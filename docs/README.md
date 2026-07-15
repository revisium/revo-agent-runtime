# Documentation

## Target contract

- [AgentManager v1 specification](./specs/agent-manager-v1.spec.md) — normative draft public API, lifecycle, results,
  events, files, bounds, errors, and invariants. It is not implemented yet.
- [Architecture](./architecture.md) — target folders, file responsibilities, dependency direction, and ownership boundary.
- [Testing](./testing.md) — proof layers, architecture/package gates, and implementation test requirements.

## Decisions

- [ADR-0001](./adr/0001-agent-runtime-boundary.md) — extract an attempt-scoped agent runtime.
- [ADR-0002](./adr/0002-agent-manager-consumer-boundary.md) — add a sealed process-local AgentManager consumer boundary.
- [ADR-0003](./adr/0003-invocation-output-recording.md) — record invocation-local output in the exact consumer directory.

## Repository policy

- [Repository contract](../REPOSITORY.md) — source-of-truth order and dependency rules.
- [Verification contract](../VERIFICATION.md) — executable local and remote quality gates.
- [Review contract](../REVIEW.md) — blocking review conditions and expected evidence.

The repository is in bootstrap. Target documents do not create a public API. Only implemented source, tests, declarations,
and declared package exports describe available runtime behavior.
