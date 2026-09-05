# Runtime architecture

This document is the responsibility ledger for the runtime source tree. The
package exposes only `src/index.ts`; every other path is private and may move
when its responsibility changes.

## Dependency direction

Dependencies point inward through portable contracts and package-private
ports:

```text
src/index.ts
  -> application/manager + discovery + composition/session
  -> execution ports/use cases + protocol/acp + platform/node

providers/* -> discovery/configuration adapter ports -> contracts
application/* -> definition + execution ports -> contracts
composition/session -> application/session + execution/session + portable ports
execution/* -> protocol ports + normalized configuration + contracts
protocol/acp -> protocol ports + normalized configuration + contracts
platform/node -> execution ports
```

Application and execution modules never import a concrete protocol or Node
adapter. Provider folders never import one another. `src/providers/index.ts`
is the single composition registration for built-in providers. Shared discovery
and ACP code remains provider-neutral: equal provider timeout values are
provider-owned definition data, not a reason to couple provider folders.

## Responsibility ledger

| Module                            | Owns                                                                                                        | Depends on                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `contracts`                       | Public definitions, discovery, configuration, manager, lifecycle, result, event, and fault types            | Nothing platform-specific                                                |
| `configuration`                   | Bounded immutable catalog normalization, derived model/provider view, and revision                          | Contracts, canonical bytes, and Node crypto                              |
| `definition`                      | Shape schema, semantic validation, canonical identity/digest, and sealed registry composition               | Contracts; Zod, canonicalize, and Node crypto at their owning boundaries |
| `discovery`                       | Provider-neutral detection runner and Node executable/package resolution ports                              | Contracts and definition validation                                      |
| `providers/codex`                 | Codex bridge identity, opaque version-probe convention, and detector                                        | Shared provider composition and discovery ports                          |
| `providers/claude`                | Claude bridge identity, opaque version-probe convention, and detector                                       | Shared provider composition and discovery ports                          |
| `providers/antigravity`           | Antigravity Registry launch identity, opaque build-label probe, and detector                                | Shared provider composition and discovery ports                          |
| `providers/cline`                 | Cline CLI identity, opaque version-probe convention, and detector                                           | Shared provider composition and discovery ports                          |
| `providers/copilot`               | GitHub Copilot CLI identity, opaque version-probe convention, and detector                                  | Shared provider composition and discovery ports                          |
| `providers/cursor`                | Cursor adjacent packaged Node/index layout identity and detector                                            | Shared provider composition and discovery ports                          |
| `providers/gemini`                | Gemini CLI identity, opaque version-probe convention, and detector                                          | Shared provider composition and discovery ports                          |
| `providers/goose`                 | Goose CLI identity, opaque version-probe convention, and detector                                           | Shared provider composition and discovery ports                          |
| `providers/grok`                  | Grok identity/detector plus legacy ACP configuration and bounded model-command fallback                     | Shared provider, ACP compatibility, and configuration ports              |
| `providers/hermes`                | Hermes CLI identity, opaque version-probe convention, and detector                                          | Shared provider composition and discovery ports                          |
| `providers/kilo`                  | Kilo CLI identity, opaque version-probe convention, and detector                                            | Shared provider composition and discovery ports                          |
| `providers/kimi`                  | Kimi Code identity, opaque version-probe convention, and detector                                           | Shared provider composition and discovery ports                          |
| `providers/opencode`              | OpenCode identity/detector plus stable ACP provider grouping                                                | Shared provider and ACP compatibility ports                              |
| `providers/qwen`                  | Qwen Code identity, opaque version-probe convention, and detector                                           | Shared provider composition and discovery ports                          |
| `providers/vibe`                  | Mistral Vibe CLI identity, opaque version-probe convention, and detector                                    | Shared provider composition and discovery ports                          |
| `discovery`                       | Portable discovery port, detector runner, and root composition                                              | Contracts and provider composition                                       |
| `platform/node/discovery`         | Node filesystem, package-layout, module-resolution, executable, and bridge discovery adapters               | Portable discovery port; Node APIs and Execa                             |
| `providers` shared files          | Typed provider registration, ACP definition construction, diagnostics, and generic detector policy          | Contracts and portable discovery ports                                   |
| `contracts/manager`               | Faceted portable manager API, lifecycle, event, and invocation contracts behind the stable facade           | Other portable contracts only                                            |
| `application/manager`             | Public manager lifecycle, collections, and invocation coordination                                          | Application features and execution ports                                 |
| `application/manager/invocations` | Accepted per-invocation terminal lifecycle and finalization                                                 | Manager semantic callbacks and invocation dependencies                   |
| `application/configuration`       | Defensive snapshot of public inspection and selection inputs                                                | Public contracts                                                         |
| `application/active-state`        | Serialized sink mutation, recovery, reservation, and snapshots                                              | Active-state contract and process identity port                          |
| `application/invocation`          | Request admission, effective inputs, preflight, and terminal finalization                                   | Definition, result, and execution ports                                  |
| `application/admission`           | Shared effective-input and process/output admission policy                                                  | Definition and execution ports                                           |
| `application/result`              | Public invocation-result construction and snapshots                                                         | Execution evidence and output contracts                                  |
| `application/faults`              | Stable translation from internal outcomes to public faults                                                  | Contracts and execution outcomes                                         |
| `application/session/management`  | Session-capable catalog, identity/capacity registry, fresh/resume opening, active and terminal queries      | Session boundaries, policies, handles, and the narrow runtime port       |
| `application/session/handles`     | Consumer-facing session/turn calls translated into correlated kernel commands                               | Session contracts, public commands, and the narrow runtime port          |
| `application/session/admission`   | Pinned definition, effective inputs, literal launch, preflight, and exclusive output preparation            | Shared admission and the preparation port                                |
| `execution/invocation`            | Executor contracts/composition, top-down lifecycle, session operations, artifacts, and terminal arbitration | Portable process/protocol ports, output, result, and security            |
| `execution/configuration`         | Inspection deadline, bounded fallback, process ownership, close, and reap                                   | Normalized catalog and portable process/configuration ports              |
| `execution/output`                | Bounded streams/events, exclusive output claim, and publication capability                                  | Contracts and redaction channel                                          |
| `execution/result`                | Raw response evidence, schema validation, and result normalization                                          | Contracts, output snapshots, and redaction channel                       |
| `execution/probe`                 | Fresh executable/version preflight policy                                                                   | Executable probe port and definition version rules                       |
| `execution/process`               | Portable owned-process, cleanup, identity, and recovery ports                                               | No concrete platform                                                     |
| `execution/session/runtime`       | Per-session actor, bounded mailbox, public-call settlement, timers, and contract-only state projections     | Pure session kernel plus private interpreter dispatch                    |
| `execution/session/kernel`        | Pure session state machine, commands, effects, events, lifecycle transitions, and projections               | Portable session contracts only                                          |
| `execution/session/interpreter`   | External effects for provider, process, event/state sinks, output, checkpointing, and cleanup               | Kernel effects and portable ports                                        |
| `execution/session/port`          | Narrow opening-preparation boundary consumed by the interpreter                                             | Kernel descriptor and portable execution contracts                       |
| `execution/security/redaction`    | Streaming channel, state engine, and independently readable matching rules                                  | No application or platform modules                                       |
| `protocol/driver`                 | Protocol-neutral invocation and configuration session ports                                                 | Contracts and normalized catalog                                         |
| `protocol/acp`                    | ACP SDK session implementation, stable configuration requester, and compatibility seam                      | Protocol ports, normalized catalog, and official ACP SDK                 |
| `protocol/session`                | Provider-neutral long-lived session, interaction, update, and continuation ports                            | Portable contracts                                                       |
| `composition/session`             | Concrete wiring of policy, state machine, actor, interpreters, ACP driver, and platform services            | Session application/execution layers and portable ports                  |
| `platform/node/process`           | Node child-process spawn, identity, cleanup, and recovered-process inspection                               | Process port; Execa and Node APIs                                        |
| `platform/node/output`            | Durable, non-replacing filesystem claim and publication                                                     | Output ports; Node filesystem APIs                                       |
| `platform/node/session`           | Runtime identities and atomic session stdout/stderr/manifest publication                                    | Session runtime and output ports; Node APIs                              |
| `platform/node/probe`             | Bounded executable resolution/version observation                                                           | Probe and process ports; Execa and Node APIs                             |

The staged `contracts/session` hierarchy owns session API, event, interaction,
lifecycle, persistence, and request declarations. Its package-private
continuation envelope is intentionally absent from both public export barrels.
`application/session/boundary` owns descriptor-safe copying and decoding of
untrusted session values; `application/session/policy` independently owns
identifier, capability, and limit decisions. Portable digest consumers depend
on `execution/security/digest/port`, never on Node crypto.

The public `AgentManager.sessions` facade composes management and handle layers
over a narrow runtime port. Consumers do not construct kernel commands, track
effect correlations, inspect mailbox state, or retain provider resources. The
root imports the session composition boundary; it does not import the kernel,
runtime, or interpreter implementation directly.

Session management delegates ID-addressed opening/ready controls to
`management/controls`; it does not duplicate the handle command translation in
the lifecycle controller. The pure reducer owns command settlement, accepted
turn identities, and process-exit transitions. Shared terminal-turn projection
lives in `kernel/reducer/turn/result`, while running and terminalizing flows
keep their separate orchestration. Prompt interpreters observe real provider
completion; control-operation deadlines never double as whole-turn deadlines.

Host-environment capture is injected at the root composition boundary.
Actor construction does not retain its original opening descriptor, and
terminal quiescence releases preparation/output resources. Immutable graph
ownership is a portable runtime resource primitive reused by interpreter
boundaries. Presentation redaction belongs to interpreter egress; the initial
event effect explicitly carries its opening policy before a preparation exists.

## Enforced structural rules

`pnpm verify:architecture` runs dependency-cruiser against the real source
graph. The declarative layer manifest rejects forbidden dependency direction;
additional rules reject cycles, unresolved or out-of-source imports,
development dependencies in production, Node ownership in contracts and
application, process spawning in the core, concrete ACP dependencies in
portable protocol ports, root-entrypoint imports from lower layers,
cross-provider imports, and exposure of the private continuation envelope.
TypeScript rejects unused locals/parameters, while pinned Knip rejects dead
exports. Code layout and readability remain ordinary design/review concerns,
not a second custom source parser.

`pnpm verify:package` additionally seeds a stale compiled artifact, proves that
the build removes it, and validates the exact current packed inventory, ESM/type
resolution, public root exports, and private deep-import denial.
