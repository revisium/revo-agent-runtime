# Repository Contract

This repository owns the reusable execution and process-local management boundary for exact, versioned AI-agent
invocations. It is a package repository, not an orchestrator, playbook catalog, workflow engine, durable store, or
system-script collection.

## Source of truth

Use this order when sources disagree:

1. Implemented source, tests, and the public export map describe shipped behavior.
2. Accepted ADRs define architecture decisions.
3. Stable specs define exact public and protocol contracts.
4. Draft specs define target behavior only and MUST remain marked unimplemented until source, tests, declarations, and
   exports implement them together.
5. `docs/architecture.md` explains current architecture and target dependency direction.
6. `README.md` is the consumer-facing summary and MUST NOT claim unimplemented behavior is available.

The current root export is intentionally empty. The AgentManager v1 specification is a draft target, not a shipped API.

## Ownership boundary

The package target owns:

- validation and digesting of a complete immutable versioned definition set;
- pure exact registry reads and bounded executable probing through one sealed manager;
- package-owned protocol, parser, and permission strategies;
- native command-line and ACP adapters;
- one invocation lifecycle, process stdio, deadlines, cancellation, and reaping;
- idempotent process-local shutdown with one shared settlement that drains accepted work, confirms owned invocation/probe
  kill and reap, and fails closed when ownership cannot be confirmed;
- process-local active and bounded retained-completed records;
- normalized results, usage, diagnostics, ordered subscriptions, and stable faults;
- bounds and redaction before subscriber delivery and file writes;
- conflict-safe recording of invocation-local files in one exact consumer-supplied directory.

The consuming host owns:

- durable definition storage and rollout;
- exact agent, model, profile, prompt, permission, result-schema, and workspace selection;
- credential storage and selection plus the explicit per-invocation environment allowlist;
- classification of explicit inherit/variables as nonsecret and credential values under `secrets`;
- immutable execution-plan compilation and persistence;
- opaque invocation-id generation and any run/step/attempt metadata;
- path construction, durable output indexing, retention, restart recovery, and public projections;
- durable retry, replay, scheduling, pipelines, gates, and workflow transitions;
- host-termination escalation after shutdown failure, with no replacement in the same supervision domain until ownership is
  resolved, plus safe-domain replacement and restart-recovery policy;
- billing ledgers and product verdict policy.

`@revisium/revo-scripts` owns bounded Git, GitHub, and other deterministic system operations. Neither package depends on the
other.

## Target dependency direction

```text
playbook and pipeline data
           |
           v
consumer orchestrator
selection, exact definitions, paths, workspace, durable state
           |
           +------------------------------+
           v                              v
@revisium/revo-agent-runtime      @revisium/revo-scripts
sealed AgentManager               bounded system operations
one physical invocation
```

Inside this package, portable runtime spec is the dependency leaf; definition and registry build immutable identity;
execution depends on package-owned ports; strategies and platform code implement those ports; application is the only
composition layer. The exact target folder and file responsibilities live in `docs/architecture.md` and are enforced by
`.oxlintrc.architecture.json` plus the architecture verification harness.

Production source MUST NOT import from a consumer application, DBOS, Prisma, Nest, GraphQL, MCP, `@revisium/revo-scripts`,
tests, fixtures, generated output, or repository scripts. Consumers depend on this package only through declared exports.

## Public surface

Public entrypoints exist only when declared in `package.json`. The bootstrap exposes an intentionally empty root. The
target AgentManager API will enter the root only when behavior tests, type-surface tests, declaration checks, packed-consumer
validation, and README examples pass together.

A `/testing` entrypoint is deferred until a demonstrated external consumer needs stable conformance fixtures. Provider or
strategy subpaths require a separate public-API decision; internal folder layout never creates an export.

## Output boundary

The manager target accepts one exact non-existing directory leaf per invocation. It creates parents, atomically claims the
leaf without adoption, and reserves `.scratch`, `events.ndjson`, `stdout.log`, `stderr.log`, failure-only
`raw-final-response.txt`, and exclusive `result.json`. It treats the path as opaque and never constructs consumer hierarchy,
replaces evidence, applies retention, or scans directories for restart recovery. Controlled completion attempts `.scratch`
cleanup; consumer recovery or retention owns crash residue by removing the invocation directory.

Late filesystem failure does not strand process-local completion. `result.json` or the terminal NDJSON line may be absent,
which is an incomplete consumer audit record; the live manager still commits and exposes one typed terminal result.
