# Repository Contract

This repository owns the reusable execution and process-local management boundary for exact, versioned AI-agent
invocations. It is a package repository, not an orchestrator, playbook catalog, workflow engine, durable store, or
system-script collection.

## Source of truth

Use this order when sources disagree:

1. Implemented source, tests, and the public export map describe shipped behavior.
2. Accepted ADRs define architecture decisions. [ADR-0013](./docs/adr/0013-seal-invocation-intent-before-preregistered-execution-handoff.md)
   owns the B+ private handoff decision.
3. Stable specs define exact public and protocol contracts. The accepted
   [execution-handoff specification](./docs/specs/execution-handoff.spec.md) owns B+ package-private target behavior.
4. Draft specs define target behavior only and MUST remain marked unimplemented until source, tests, declarations, and
   exports implement them together.
5. `docs/architecture.md` explains current architecture and target dependency direction.
6. `README.md` is the consumer-facing summary and MUST NOT claim unimplemented behavior is available.

The current root export is intentionally empty. Internal definition, registry, executable-probe, and deterministic
lifecycle/result slices are implemented and tested, but remain private. The AgentManager v1 specification is a draft target,
not a shipped API. Its first platform/filesystem implementation and evidence target is Linux with a local `ext4` filesystem;
macOS requires later native evidence, and Windows is outside the MVP. This sequence is not a shipped support claim.

## Ownership boundary

The package target owns:

- validation and digesting of a complete immutable versioned definition set;
- pure exact registry reads and bounded executable probing through one sealed manager, plus fresh resolved-path and strict-
  SemVer preflight before each invocation claims output or spawns;
- package-owned protocol, parser, and permission strategies;
- sealed resource-independent preclaim preparation, authentic invocation-bound one-use carriers, preregistered local claim,
  preparation, and process-start attempts, and retained settlement/quiescence owners;
- native command-line and ACP adapters;
- one invocation lifecycle, paused process I/O before acceptance, one duplex coordinator, exact parser observations and
  normalization, deadlines, provider-neutral advisory cancellation dispatch, authoritative local process-group cleanup, and
  reaping;
- idempotent process-local shutdown with one shared settlement that drains accepted work, confirms owned invocation/probe
  kill and reap, and fails closed when cleanup cannot be confirmed;
- process-local active records and a retained-completed FIFO with an exact construction bound of 1 through 1,000 records;
- bounded local `darwin`/`linux` process identity, consumer-backed active-state notifications, and one-shot cleanup of
  consumer-supplied active snapshots;
- normalized results, usage, bounded redacted technical evidence, lifecycle-only ordered synchronous subscriptions without an
  internal listener queue, and stable faults;
- bounds and independent redaction before parser/evidence/subscriber/file boundaries;
- conflict-safe output claim, preparation, separate non-replacing eligible-raw/result publication, cleanup, and filesystem
  quiescence in one exact consumer-supplied directory.

The consuming host owns:

- durable definition storage and rollout;
- exact agent, model, profile, prompt, permission, result-schema, and workspace selection;
- invocation admission, concurrency, listener execution cost, downstream buffering, fanout, and backpressure;
- workspace authorization, ownership/provenance assessment, and any stronger realpath, symlink, or containment policy;
- credential storage and selection plus the explicit per-invocation environment allowlist;
- classification of explicit inherit/variables as nonsecret and credential values under `secrets`;
- immutable execution-plan compilation and persistence;
- opaque invocation-id generation and any run/step/attempt metadata;
- active-row storage and loading, distributed coordination, path construction, output-hierarchy provisioning and its trusted
  stable-ancestor warranty through terminal filesystem quiescence, durable output/result indexing, retention, recovery policy,
  and public projections;
- durable retry, replay, scheduling, pipelines, gates, and workflow transitions;
- host-termination escalation after shutdown failure, with no replacement in the same supervision domain only while
  manager-owned process cleanup remains unresolved;
- affected-id/path quarantine and continued stable-ancestor warranty while output settlement remains uncertain, without a
  global replacement ban;
- affected-id/row preservation for consumer-backed reconciliation by a fresh manager while active-state settlement remains
  uncertain;
- billing ledgers and product verdict policy.

`@revisium/revo-scripts` owns bounded Git, GitHub, and other deterministic system operations. Neither package depends on the
other.

Normal in-memory signalling requires the manager's authentic private live authority, its transferred coordinator owner, or
its retained cleanup owner. Recovery cleanup has a separate ADR-0009 authority source: a fresh package observation whose
recomputed fingerprint exactly matches the saved fingerprint. Persisted PID, process-group id, invocation identity, pin,
timestamp, or epoch alone never authorizes signalling.

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

Inside this package, portable runtime spec and immutable policy are independent dependency leaves; errors depend only on
specification types; definition behavior may depend on spec, policy, and errors. Registry builds immutable identity from
definition and spec. Execution is a parallel building block over portable contracts and its own ports; neither registry nor
execution depends on the other. Strategies and platform code only implement execution-owned ports. Application is the only
composition and drain-registration layer: it wires registry, execution, strategies, and platform and transfers authentic
ownership between pending and accepted phases. Adapters do not reread the registry, select providers, or create a second
composition path. The accepted PR #4 structure and import rules
live in `docs/specs/internal-module-structure.spec.md`; broader target responsibilities live in `docs/architecture.md`.
`.oxlintrc.architecture.json` and the architecture verification harness enforce both.

Production source MUST NOT import from a consumer application, DBOS, Prisma, Nest, GraphQL, MCP, Kubernetes,
`@revisium/revo-scripts`, tests, fixtures, generated output, or repository scripts. The public recovery contract MUST NOT
expose claims, leases, host ids, or consumer database types. Consumers depend on this package only through declared exports.

## Public surface

Public entrypoints exist only when declared in `package.json`. The bootstrap exposes an intentionally empty root. The
target AgentManager API will enter the root only when behavior tests, type-surface tests, declaration checks, packed-consumer
validation, and README examples pass together.

A `/testing` entrypoint is deferred until a demonstrated external consumer needs stable conformance fixtures. Provider or
strategy subpaths require a separate public-API decision; internal folder layout never creates an export.

## Output boundary

The manager target accepts one exact non-existing directory leaf per invocation. The consumer provisions the existing parent
hierarchy and warrants trusted stable ancestors until all package filesystem operations for the start have settled. Before
exclusive absent-leaf creation, application preregisters an authentic claim owner; before the first postclaim mutation, it
preregisters the output port's publication/cleanup authority. Unknown claim or preparation settlement retains the identical
authority, quarantines the affected id/path, and extends that warranty without creating a public invocation.

The output port alone constructs independent stdout, stderr, and protocol redaction fronts and bounded raw destinations. It
reserves `.scratch`, `events.ndjson`, `stdout.log`, `stderr.log`, eligible failure-only `raw-final-response.txt`, and
`result.json`; eligible raw evidence and the terminal result publish separately without replacement. The package treats the
path as opaque, never constructs consumer hierarchy, adopts or replaces evidence, applies retention, or scans directories
for restart recovery. Controlled completion attempts manager-owned scratch/temp cleanup and retains publication authority
until filesystem quiescence. Consumer result recovery or retention owns quarantined/crash residue by removing the invocation
directory. Separately, the consumer may persist only active process snapshots through the package sink and supply those rows
to one-shot manager initialization. Those rows never contain results or completed history.

Late filesystem failure does not strand process-local completion. `result.json` or the terminal NDJSON line may be absent,
which is an incomplete consumer audit record; the live manager still commits and exposes one typed terminal result. A terminal
lifecycle event signals result availability through the result APIs; it does not carry output, diagnostics, files, or a result.
V1 does not claim hostile-ancestor safety from pathname normalization, realpath, or containment checks.
