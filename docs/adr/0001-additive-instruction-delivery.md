# ADR 0001: Additive instruction delivery with portable MCP descriptors

Status: accepted for the `0.3.0-alpha.7` local alpha.

## Context

Consumers need to hand an agent run persistent instructions and MCP server
descriptors without editing host-owned files (`CLAUDE.md`, `AGENTS.md`,
`.revo/`) and without the runtime becoming a knowledge or CLI manager. Provider
bridges differ: the bundled Claude bridge accepts an additive
`_meta.systemPrompt.append` object on session creation, OpenCode `1.18.23`
set-unions an `instructions` file list supplied through `OPENCODE_CONFIG_CONTENT`,
and the pinned Codex bridge, Grok, and the other ACP definitions expose no
additive instruction field. A string `_meta.systemPrompt` or Codex
`baseInstructions` would replace the provider's base rules.

## Decision

- `instructions?: string` and `mcpServers?` are portable contract fields on
  invocation starts and session launches. Empty instructions equal omission and
  leave wire frames byte-identical; legacy `{ delivery, text }` objects and
  `instructions` on `send()` are rejected as invalid parameters.
- One pure execution-layer port, `InstructionsDeliveryResolver`, decides the
  channel once per process incarnation after preflight and output claim, before
  spawn. Provider implementations live in `providers/claude` (bridge-version
  gated `_meta` append) and `providers/opencode` (reported-version gated private
  file + environment) and are composed at the package root. Everything else uses
  the delimited first-prompt prefix (`<<<REVO_INSTRUCTIONS>>>` …
  `<<<END_REVO_INSTRUCTIONS>>>`), sessions on their first turn only.
- Drivers record the decision and never fall back: a provider rejection after a
  native channel was chosen is `revo.agent.protocol_failed` with the provider
  reason in `details.diagnostic.provider`.
- The OpenCode file lives inside the runtime-claimed `0700` output directory,
  is created exclusively with mode `0600`, and is removed only after confirmed
  process teardown. Its path and the instruction text never enter runtime-owned
  records (events, snapshots, results, faults, checkpoints, files manifest).
- Checkpoints carry an instruction digest, the delivery mode, and a
  prefix-dispatched flag. Resume requires identical instructions
  (`revo.agent.checkpoint_invalid` otherwise, without consuming the token), keeps
  a native channel only when both stored and currently eligible, and never
  injects a prefix twice.
- Resolved MCP env/header values join the incarnation redaction set in both
  launch paths; HTTP servers require the advertised ACP capability.
- The effective channel is observable as `instructionsDelivery` on results,
  `session.opened`, and snapshots. Built-in definitions keep `resume: 'none'`;
  native resume behavior is verified with fake definitions only.

## Consequences

Consumers get one contract across providers with observable delivery, while
provider coupling stays in one file per provider and the protocol layer knows
no provider names. Adding a native channel means re-verifying that provider's
source facts and its version pin.
