# Review Contract

Use this checklist for human, bot, and agent review. Findings should cite the concrete file and line, identify the violated contract, explain the risk, and propose the smallest sufficient correction.

## Blocking findings

Block the change when any of the following applies:

- Behavior or public type changes are not covered by tests at the appropriate boundary.
- Package exports, declarations, README examples, and implementation describe different public surfaces.
- Runtime code selects runners, models, profiles, workspaces, retry policy, or pipeline transitions instead of executing a resolved invocation.
- Public contracts expose provider SDK, orchestrator, DBOS, Prisma, Nest, GraphQL, MCP, or playbook-owned types.
- Events, terminal streams, diagnostics, or artifacts can grow without an explicit bound or reach a sink before redaction.
- Native command-line and ACP adapters return incompatible outcome or observability contracts.
- A deep import, broad root barrel, dependency cycle, or reverse dependency bypasses the intended package DAG.
- New code uses `any`, `@ts-ignore`, an unchecked assertion, silent error swallowing, or an unbounded external payload.
- System mechanics and business decisions are mixed into an unreadable unit.
- A speculative abstraction or compatibility fallback is introduced without an approved requirement.
- Runtime source depends on tests, fixtures, generated output, build scripts, or repository tooling.
- A lint, format, type, test, coverage, package, or workflow failure is suppressed instead of fixed.
- A quality exception lacks an owner, rationale, and expiry or removal condition.
- Required verification is skipped without a concrete reason and residual-risk statement.
- CI, Sonar, or review threads contain unresolved valid findings.
- A release change can publish without an explicit release approval gate.

## Expected evidence

- `pnpm verify` passed on the reviewed head.
- Conditional checks from `VERIFICATION.md` were run or marked not applicable.
- CI passed on the same commit.
- Sonar Quality Gate and issue-level results were inspected when provider access was available.
- The packed artifact contains only the declared public files.
- Documentation changed whenever the public package contract changed.
