# Providers

Built-in discovery returns locally launchable ACP v1 definitions. A discovered
definition proves its executable boundary only; authentication, account setup,
session configuration, and prompt success remain provider-owned conditions.
Discovery never installs or updates a provider CLI.

All built-in ACP definitions currently advertise hot multi-turn sessions,
permission and structured-input interactions, assistant messages, plans, tool
activity, and usage. Progress updates are conservatively disabled. Native
resume is not advertised until a provider path proves a stable continuation
contract. Actual capabilities are intersected with the provider response when
the session opens; consumers must use the negotiated session capabilities.

| Provider    | Definition        | Source         | Launch policy                                                                          |
| ----------- | ----------------- | -------------- | -------------------------------------------------------------------------------------- |
| Codex       | `codex-acp`       | bundled bridge | Exact pinned bridge; explicit system override is validated with no fallback.           |
| Claude      | `claude-acp`      | bundled bridge | Exact pinned bridge; explicit system override is validated with no fallback.           |
| Antigravity | `antigravity-acp` | system         | Provider executable; literal `--uid=` argument is preserved without deriving identity. |
| Cline       | `cline-acp`       | system         | Provider CLI in ACP mode.                                                              |
| Copilot     | `copilot-acp`     | system package | Canonical JavaScript package entrypoint launched by the runtime Node executable.       |
| Cursor      | `cursor-acp`      | system package | Validated adjacent packaged Node and `index.js` layout.                                |
| Gemini      | `gemini-acp`      | system         | Provider CLI in ACP mode.                                                              |
| Goose       | `goose-acp`       | system         | Provider CLI in ACP mode.                                                              |
| Grok        | `grok-acp`        | system         | Provider CLI in ACP mode.                                                              |
| Hermes      | `hermes-acp`      | system         | Provider CLI in ACP mode.                                                              |
| Kilo        | `kilo-acp`        | system package | Canonical JavaScript package entrypoint launched by the runtime Node executable.       |
| Kimi        | `kimi-acp`        | system package | Canonical JavaScript package entrypoint launched by the runtime Node executable.       |
| OpenCode    | `opencode-acp`    | system         | Provider CLI in ACP mode.                                                              |
| Qwen        | `qwen-acp`        | system package | Canonical JavaScript package entrypoint launched by the runtime Node executable.       |
| Vibe        | `vibe-acp`        | system         | Provider executable in ACP mode.                                                       |

System package discovery fails closed unless it can validate the package
entrypoint. It does not run a PATH-dependent npm wrapper. Cursor likewise
rejects unrelated `agent` launchers. Explicit overrides are consumer-selected
absolute executables; an invalid override fails rather than falling back.

## Configuration

`manager.inspectConfiguration()` uses stable ACP `configOptions` when a provider
supplies them. The returned catalog contains provider-neutral select and boolean
options, current values, a revision, and an optional model view.

Grok has a narrow compatibility adapter for legacy session model metadata and a
bounded `grok models` fallback when stable options are absent. OpenCode model
values are grouped by the session-available provider instead of flattened; the
catalog identifies the current provider and model without discarding other
available groups.

The caller may persist a catalog, but every `start()` validates explicit
selections against its own fresh session. Missing or stale values fail before a
prompt and are never replaced implicitly.

## Readiness

Use `manager.probeAgent()` to obtain current executable/version evidence. It is
not an authentication check. A live provider requires its executable, provider
setup, authentication, network access, and any account-specific prerequisites
in the caller's environment. The runtime does not perform login, account
switching, installation, or credential management.

## Session smoke checks

`pnpm smoke:session` runs deterministic fake-provider continuity, cancellation,
permission, and structured multi-select scenarios. Set
`REVO_LIVE_SESSION_SMOKE` to `codex`, `claude`, or `opencode` to exercise one
installed provider, or to `all` for the maintained three-provider matrix:

```sh
REVO_LIVE_SESSION_SMOKE=all pnpm smoke:session
```

The live check proves two turns use one hot provider session, verifies the
remembered nonce, cancels an in-flight turn, confirms active-state cleanup, and
reports native resume as either passed or unsupported. It deliberately uses an
explicit catalog-backed model for Codex, Claude, and OpenCode so a changing
provider default cannot silently change the test.
