# Architecture

## Purpose

`@revisium/revo-agent-runtime` executes one resolved AI-agent invocation. It gives native command-line runners and ACP the same process, observability, result, and cancellation boundary while remaining independent from any workflow engine or product database.

## Runtime flow

1. The consumer selects a runner, model, permissions, and workspace while compiling its immutable execution plan.
2. The consumer passes a complete invocation specification and ephemeral host context to the runtime.
3. The runtime validates the pin and resolves only package-owned strategy identifiers.
4. A native command-line or ACP adapter executes one physical attempt through the shared process lifecycle.
5. The runtime bounds and redacts ordered events, diagnostics, terminal tails, and artifact data before forwarding them to consumer-provided sinks.
6. The runtime returns a normalized outcome. The consumer persists it and decides retry, workflow, gate, or terminal behavior.

The runtime never reads a mutable runner catalog during execution or recovery. Missing pinned strategies fail closed.

## Internal areas

- **contracts** — JSON-compatible invocation, outcome, event, error, usage, and provenance types;
- **manifest** — runner manifest schema and validation;
- **strategies** — sealed protocol-driver, stdout-parser, and permission-style registry;
- **process** — spawn, stdio, deadlines, cancellation, kill, and reaping;
- **adapters** — Codex, Claude, and ACP implementations behind package-owned contracts;
- **observability** — bounded redaction, events, terminal tails, and artifact-sink coordination;
- **testing** — reusable adapter conformance fixtures and deterministic fakes.

These are ownership areas, not a commitment to separate npm packages or public subpaths.

## ACP boundary

ACP is a private adapter to the same invocation contract as native command-line runners. Third-party SDK types do not cross the public package boundary. An official ACP SDK may replace package-owned framing only after conformance tests prove parity for correlation, hostile input, permissions, cancellation, diagnostics, and process/session isolation.

The initial lifecycle is attempt-scoped: one physical attempt owns one process, at most one ACP session, and one top-level prompt. Pooling and cross-attempt session resume are outside the initial boundary.

## Observability boundary

The runtime owns normalization, ordering, bounds, redaction, terminal tails, and sink-delivery semantics. The consumer owns durable files and database rows, fan-in, cursor APIs, retention, and user-facing projections. Temporary protocol files are invocation scratch, not durable product artifacts.

## Quality attributes

- **Replay safety:** execution uses complete immutable pins and package-owned strategy identifiers.
- **Security:** secrets stay outside durable specifications; output is bounded and redacted before sinks.
- **Cancellation:** abort propagates through protocol shutdown and authoritative process kill/reap.
- **Backpressure:** event and byte limits are explicit in the invocation contract; unbounded in-memory terminal capture is forbidden.
- **Portability:** the core does not depend on consumer frameworks or persistence.
- **Testability:** every adapter passes one shared invocation, event, error, cancellation, and result contract suite.
