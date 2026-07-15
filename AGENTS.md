# Revo Agent Runtime Repository

This file is the repository-local contract for coding agents. When this repository is checked out inside the Revisium workspace, the workspace canonical agent playbook also applies. This file wins for concrete commands, package constraints, and repository policy.

## Repository facts

- Package: `@revisium/revo-agent-runtime`.
- Package manager: pnpm 11.13.0 through Corepack.
- Runtime: Node.js `>=24.11.1 <25`.
- Language: strict TypeScript 7, ESM, and NodeNext module resolution.
- Protected base branch: `master`.
- Primary local gate: `pnpm verify`.
- Static analysis: SonarCloud through the repository tooling and workflow committed here.
- The bootstrap package intentionally has no runtime API yet.

## Required reading

Before editing, inspect:

1. `README.md` for the public package status and supported commands.
2. `REPOSITORY.md` for source-of-truth order, ownership boundaries, and dependency direction.
3. `docs/README.md` and the relevant architecture document or ADR.
4. `VERIFICATION.md` for exact required, conditional, and remote gates.
5. `REVIEW.md` for the review blockers.
6. `package.json`, the export map, and the relevant source and tests.

When architecture, specifications, or ADRs are added, treat their declared source-of-truth order as authoritative instead of inferring behavior from neighboring repositories.

## Working rules

- Keep changes scoped to the approved request and preserve unrelated work.
- Do not commit directly to `master`.
- Do not push, create or update a pull request, merge, publish npm packages, or mutate external services without the corresponding approval.
- Run targeted checks while iterating and the complete `pnpm verify` gate before handoff or publication.
- After a push, inspect CI, Sonar findings when accessible, and unresolved review threads. Do not treat a top-level green status as proof that issue-level findings are clear.
- Record missing credentials or provider access as skipped or blocked, never as passed.

## Engineering rules

- Start behavior changes with a failing test. Prefer contract and observable-behavior tests over implementation-detail assertions.
- Use the smallest sufficient implementation. Add abstractions only for an existing boundary, variation, or test seam.
- Keep each unit at one abstraction level and give it one bounded responsibility.
- Keep business decisions separate from process, filesystem, network, provider, and presentation mechanics.
- Keep the package attempt-scoped. Runner selection, execution planning, workspace allocation, durable retry, persistence, and pipeline transitions remain consumer responsibilities.
- Keep protocol and provider SDK types behind package-owned adapters. Public contracts must remain provider-neutral and JSON-compatible where they cross a durable boundary.
- Bound and redact events, terminal output, diagnostics, and artifacts before they reach consumer sinks.
- Treat native command-line runners and ACP as adapters to one invocation contract, not independent execution paths.
- Do not add a dependency on orchestrator, DBOS, Prisma, Nest, GraphQL, MCP, or `@revisium/revo-scripts`.
- Model expected failures explicitly with typed results or errors. Never swallow errors silently.
- Preserve strict types. Do not use `any`, `@ts-ignore`, broad casts, unchecked assertions, or weaker public types to bypass a failing gate.
- Reject or bound externally supplied collections, strings, artifacts, and payloads at their owning boundary.
- Prefer names, types, and decomposition over explanatory comments. Comments are reserved for non-obvious invariants, compatibility constraints, protocols, or lifecycle hazards.
- A quality-rule exception must be narrow and identify its owner, rationale, and expiry or removal condition.
- Do not introduce dependency cycles, deep imports around the export map, or multiple public paths to the same contract.
- Runtime code must not depend on test helpers, generated output, build scripts, or repository tooling.
- Generated files, fixtures, coverage, and build output must stay outside production quality metrics without hiding owned production source.

## Public package contract

- Public entrypoints are declared explicitly in `package.json`; filesystem layout alone never makes a module public.
- Public TypeScript changes require runtime tests where behavior exists, type-surface coverage, declaration validation, export validation, and updated README examples.
- Keep ESM-only behavior intentional. Do not add CommonJS compatibility, root barrels, fallback exports, or duplicate entrypoints without an approved compatibility requirement.
- Runtime dependencies require a demonstrated package responsibility and dependency-DAG review.
- Do not publish from a local machine or add publishing credentials to repository files.

## Verification

Follow `VERIFICATION.md`. If it conflicts with scripts or CI, report the mismatch and use the safest current command set until the contract is corrected. Never claim an unexecuted gate passed.
