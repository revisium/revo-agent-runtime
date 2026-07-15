# Repository Contract

This repository owns the reusable, attempt-scoped execution boundary for AI agents. It is a package repository, not an orchestrator, playbook catalog, workflow engine, or system-script collection.

## Source of truth

Use this order when sources disagree:

1. Implemented source, tests, and the public export map describe shipped behavior.
2. Accepted ADRs define architecture decisions.
3. Stable specs define exact public and protocol contracts once they exist.
4. `docs/architecture.md` explains the current architecture and target direction.
5. `README.md` is the consumer-facing summary and must not claim unimplemented behavior is available.

Draft examples describe target design only. They do not create a public API until source, tests, declarations, and exports implement that contract together.

## Ownership boundary

The package owns one physical agent invocation:

- validation of a complete pinned runner manifest;
- resolution of package-owned protocol, parser, and permission strategies;
- native command-line and ACP adapters;
- process lifecycle, standard streams, deadlines, cancellation, and reaping;
- normalized results, usage, diagnostics, events, and artifact references;
- bounds and redaction before data reaches consumer sinks.

The consuming host owns:

- runner, model, profile, and credential selection;
- immutable execution-plan compilation and persistence;
- prompts, roles, playbooks, pipelines, and human gates;
- workspace allocation and lifecycle;
- durable retry, replay, scheduling, and workflow transitions;
- event and artifact persistence, fan-in, cursors, and public projections;
- billing ledgers and product policy.

`@revisium/revo-scripts` owns bounded Git, GitHub, and other deterministic system operations. Neither package depends on the other.

## Dependency direction

```text
playbook and pipeline data
           |
           v
consumer orchestrator
selection, execution plan, workspace, durable state
           |
           +------------------------------+
           v                              v
@revisium/revo-agent-runtime      @revisium/revo-scripts
one agent invocation              bounded system operations
```

Production source must not import from a consumer application, DBOS, Prisma, Nest, GraphQL, MCP, or the scripts package. Consumers depend on the package only through declared exports.

## Public surface

Public entrypoints exist only when declared in `package.json`. The initial bootstrap exposes an intentionally empty root. Start with the smallest root contract and add a `/testing` entrypoint only when consumer contract fixtures exist. Provider-specific subpaths require a demonstrated consumer and a separate public-API decision.
