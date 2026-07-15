# ADR-0001: Extract an attempt-scoped agent runtime

- Status: Accepted
- Date: 2026-07-15
- Refined by: [ADR-0002](./0002-agent-manager-consumer-boundary.md)
- Narrowly amended by: [ADR-0003](./0003-invocation-output-recording.md)

## Context

Revo currently launches native Codex and Claude processes, parses their outputs, records usage and artifacts, and is adding ACP session support. Keeping each transport as an independent host implementation would duplicate process, cancellation, observability, and result semantics. Combining this work with orchestration or system scripts would instead mix components with different durability and security responsibilities.

## Decision

Create `@revisium/revo-agent-runtime` as an independently versioned package for one physical agent invocation.

The package owns manifest validation, package-owned strategy resolution, native and ACP adapters, process lifecycle, normalized outcomes, and bounded redacted observability. It consumes a complete immutable runner pin and does not select runners or read a mutable runner catalog.

The consuming orchestrator retains execution-plan compilation, runner/model/profile selection, prompts, workspaces, durable retries, pipelines, gates, durable workflow persistence, and public projections. `@revisium/revo-scripts` remains a sibling package for deterministic system operations, with no dependency in either direction.

ADR-0002 refines the consumer boundary with a sealed process-local `AgentManager`. ADR-0003 narrowly assigns bounded,
redacted invocation-local file recording to the runtime in an exact directory supplied by the consumer. The consumer still
owns path construction, durable indexing, retention, and restart recovery.

The initial public API is package-neutral. Provider and ACP SDK types remain private implementation details. The initial lifecycle does not pool processes or resume sessions across physical attempts.

## Consequences

- Codex, Claude, and ACP must satisfy one adapter contract and return one normalized outcome.
- Consumer-owned types such as steps, roles, workflow records, database models, and public API projections cannot enter the package core.
- Events and output must be bounded and redacted before consumer sinks.
- Durable retry and workflow advancement remain outside the package.
- The consumer adopts an exact package version and performs one production cutover without dual routing or compatibility fallbacks.
- A separate Git repository provides an independent CI and release boundary, but package correctness cannot depend on repository topology.

## Rejected alternatives

- **Keep all runners in the orchestrator:** preserves duplicated protocols and couples agent lifecycle changes to the application.
- **Create an ACP-only package:** leaves native runners on a different process, result, and logging path.
- **Combine agents and scripts:** mixes probabilistic agent invocation with deterministic privileged effects.
- **Publish one package per provider:** creates release edges before separate public consumers or contracts exist.
