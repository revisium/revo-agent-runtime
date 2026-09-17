# Context feature — temporary handoff

Continue this implementation; do not restart it. Delete this file after the
remaining work is accepted. This is a WIP transfer, not a release approval.

## Branch and scope

- Branch: `feat/native-context-alpha-20260912`; original base:
  `511546fb698ca8e124ecbf892671d68a5c833ffe` (master at development time).
  Compare with current upstream before integration; do not assume master stayed
  unchanged. Do not merge the separate multi-CLI PoC as part of this task.
- Package version is `0.3.0-alpha.7`, previously packed locally, not published by
  this work. Check current registry/release state before choosing a release version.
- This branch contains runtime implementation, tests, documentation and the tiny
  MCP fixture. No dependency on the previous chat or local run directory is intended.
- Separate revo-core GraphQL/session, hierarchical `.revo/*.md`, knowledge CLI and
  authorization-grant PoCs are NOT included or required to finish this runtime slice.
- No merge, npm publication, provider login, credential changes or CLI upgrades
  are authorized by this handoff. Finish local review/live evidence first.

## Required public behavior (already implemented; preserve)

Sources of truth: `docs/API.md` (Instructions and MCP servers),
`docs/ARCHITECTURE.md`, `docs/PROVIDERS.md`,
`docs/adr/0001-additive-instruction-delivery.md`, `src/contracts/context.ts`.

1. Invocation start and session open/resume accept `instructions?: string` and
   `mcpServers?: AgentMcpServer[]`, separate from the user's `prompt`. No public
   delivery selector. Legacy object instructions are invalid; `send()` cannot
   replace instructions. Empty instructions behave exactly like omitted input.
2. Add to provider base instructions; never replace them. Claude bridge `0.70.0`
   uses ACP `_meta.systemPrompt: { append: text }` (bridge version, not CLI version).
   OpenCode CLI `1.18.23`, non-Windows, uses a private instructions file through
   additive `OPENCODE_CONFIG_CONTENT`. Preserve caller/provider configuration.
3. Unsupported native delivery falls back to first-prompt prefix exactly:
   `<<<REVO_INSTRUCTIONS>>>\n<instructions>\n<<<END_REVO_INSTRUCTIONS>>>\n\n<prompt>`.
   Codex/Grok use prefix. Do not duplicate on subsequent turns. Once native was
   selected, a provider rejection is an error, not a retry with prefix.
4. OpenCode prefix fallback also applies when caller/definition binds
   `OPENCODE_CONFIG_CONTENT` in any case or output path contains braces. Native
   file: exclusive creation, owner-only permissions, owned output directory;
   remove only after confirmed process teardown, retain on uncertain teardown.
   Cover failed/late/unstarted invocation and session cleanup paths.
5. Report `instructionsDelivery` (`mode`, closed `channel` union) in invocation
   result/session opened/snapshot. No context payload in owned metadata. Conversation
   output may legitimately echo instructions; instructions are not automatically secrets.
6. MCP stdio/http descriptors use `{ value: string }` or `{ environment: string }`
   env/header bindings. Resolve against captured launch environment, fail before
   spawn on missing binding; require HTTP capability, never silently drop servers.
   Every resolved binding value is redacted from all outputs, events, faults,
   captured frames and provider echoes. Descriptor delivery alone is NOT tool-use proof.
7. Capture bounded immutable plain input; retain existing validation limits and
   strict JSON result parser. Resume stores instruction digest, not text, and
   rejects mismatched instructions without consuming token. Built-in providers
   still advertise no native resume; fake-provider tests are not live resume proof.
8. Runtime owns delivery/process lifecycle, not playbook resolution, `.revo`
   materialization, knowledge service/CLI installation, login or grant issuance.
   The host supplies instructions/MCP and prepares the workspace. Knowledge
   run/dialogue IDs are correlation, not authorization credentials.

## Current evidence and remaining risks

Fresh handoff verification on September 17: `corepack pnpm verify` passed,
1988 tests / 272 files, 100% coverage, architecture 389/1603, exact 1491-file
package validation. This confirms local gates, not live-provider acceptance.

Historical evidence from September 13 (original ignored reports are now absent):

- Full verify: 1988 tests / 272 files, 100% coverage; architecture 389 modules /
  1603 dependencies; package validation 1491 files. Local alpha packed.
- Runtime implementation received Claude/Grok reviews before the latest harness
  fix. Latest nine-file harness delta received independent Grok review: 41 tests
  plus negative/forwarding probes passed. Claude's latest review did not run due
  to quota. Old reset time is NOT a current readiness check. Obtain fresh review.
- Earlier live Codex accidentally used npm CLI `0.145.0`, not installed standalone
  `0.154.0`; default `gpt-6-astra` returned HTTP400 requiring a newer CLI. Not an
  auth failure and not evidence against context delivery. No upgrade was needed.
- Latest harness now unshadows Node-bin PATH, uses `systemExecutableOverrides`
  and existing preferred-model helper. Selected models: Codex `gpt-5.6-luna`,
  OpenCode `xai/grok-4.20-0309-non-reasoning`, Claude helper `sonnet`.
  Missing selected model must fail, not silently switch. Default-model coverage
  is a separately labelled JSON-only probe. Latest corrected live runs NOT done.

Resolve before accepting live results:

- OpenCode preflight attests xAI, but default-model JSON probe can select another
  provider. Bind readiness to each actual selection; never reuse xAI readiness
  for a different provider. Catalog availability is not auth readiness.
- `opencode-spawn-preflight.ts` is an installer, not self-activating. Old ignored
  run-local wrappers/Codex spawn guard are missing. Do not run bare live smoke
  assuming it performs real auth checks: `REVO_LIVE_AUTH_SOURCE` only declares intent.
  Restore a portable reviewed launcher/guard before live. OpenCode implementation
  and regression tests are already in `test/smoke/support/`; no need to recreate them.
- Actual preflight must use identical child cwd/env/config/user/executable. For
  Codex, inspect resolved `CODEX_PATH` and run `login status` in that context;
  normalize in memory and detect competing sources. For OpenCode use positive
  selected-provider auth status, not nonempty `auth list` (zero entries still exit0).
  Forward original command/options unchanged; synchronize builtin ESM exports
  when intercepting spawn, since Execa can otherwise bypass the guard. Test with
  fake CLIs before model calls. No tokens/account IDs/raw auth output in reports.
- Unresolved executable currently falls back to PATH discovery. Require verified
  canonical CLI identity before live. Do not confuse pinned Node with vendor CLI.
- Permissions are intentionally denied when exact MCP identity cannot be proven.
  Permission-required cases are blocked, not pass. Open-time permission polling
  and invocation permission classification have known limitations.
- Exact `echo` tool-title matching may reject OpenCode `knowledge_echo` despite
  real fixture audit. Report audit and observer separately; investigate rather
  than weakening acceptance to assistant text or allowing arbitrary permissions.
- Retention checks root symlinks, but nested label/file symlink hardening is
  incomplete: only use a fresh empty private evidence directory, never caller data.
- All-value MCP redaction can corrupt results for ordinary values like `answer`.
  Current PoC uses unique high-entropy synthetic tokens (at least 16 characters).
  This is NOT production readiness for ordinary bindings or permission to skip
  redaction of short secrets. Additive `{ plain: string }` was proposed only;
  any public binding redesign needs separate approval.

## Commands and acceptance

Read `AGENTS.md`, `VERIFICATION.md`, `REVIEW.md`, `REPOSITORY.md` first.
Use Node `>=24.15 <25` (recommended `24.18.0`) and pnpm `11.13.0`.
From repository root, with those versions selected:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm smoke:context
corepack pnpm pack
```

With `REVO_LIVE_CONTEXT_SMOKE` unset, `smoke:context` runs the fake-provider path.
Ensure no inherited live selection when running it as a local check. `verify`
does not perform real model calls. Do not commit tarball, dist, coverage or credentials.

Live inputs, ONLY after launcher/preflight repair and review:

- `REVO_LIVE_AUTH_SOURCE=cached-login`
- `REVO_LIVE_CONTEXT_SMOKE=codex` or `opencode` (one provider per attempt)
- `REVO_LIVE_CONTEXT_EVIDENCE_DIR=<fresh empty private directory>`
- Entry: `node --import tsx test/smoke/context.ts`, preceded by the reviewed
  spawn-time guard. The current selector also supports `grok`/`all`, NOT Claude;
  add scoped Claude coverage if completing the full original provider matrix.

Before calls record canonical executable/version and selected/default model.
Check current login/quota without changing credentials; auth failure stops that
provider, no automatic retry/account/model fallback. Never treat old CLI versions
or model availability as current facts. Use private 0700 directories/0600 evidence.

Require BOTH invocation and session to demonstrate instruction-only nonce,
expected delivery channel, real fixture-server `tools/call echo` audit correlated
to that path AND tool event/frame, valid task result, no secret exposure and
confirmed cleanup. Nonce in transport, assistant tool claims, protocol idle,
or extra probe success do not satisfy the combined gate. Keep raw reasoning out
of retained evidence. Report blocked/failed/missing separately, not as success.

Next order: fresh Claude review + adjudicate findings; minimal tested guard fixes;
review changed code; corrected Codex/OpenCode live; complete or explicitly defer
Claude/Grok live coverage; CI/Sonar and release decision. Handoff push alone does
not imply CI passed (current CI push trigger only master/release; PR or explicit
workflow needed). No PR/merge/publication was requested for this transfer.
