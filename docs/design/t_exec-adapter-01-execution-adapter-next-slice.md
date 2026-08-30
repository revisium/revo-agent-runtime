<!-- v2 of this artifact. v1 (single-slice "explicit child-environment capture" recommendation) is superseded by an
explicit user scope correction: the developer slice must define one bounded pre-spawn security substrate covering
child-environment capture PLUS sealed secret registration PLUS streaming redaction PLUS a bounded redacting
stdout/stderr guard. v1's current-state evidence is still valid at the new base and is retained below with the
minimum edits needed to reconcile it against the now-merged PreparedLaunch PR (#41, commit bba9882) and the
worktree's own in-progress child-environment diff. Nothing in v1's §1 evidence table was found to be wrong; it was
incomplete for the new base. -->

<!-- Provenance note carried forward from v1: the very first draft of this artifact (and of
t_exec-adapter-02-child-environment-capture-architecture.md) was written to `coverage/kanban/...` and destroyed by
vitest's coverage-v8 `clean: true` reportsDirectory wipe on a later `pnpm test:cov`/`pnpm verify` run. Both files
were moved/reconstructed into `docs/design/` before this v2 edit. Do not write artifacts under `coverage/` again. -->

<!-- Historical plan: its missing/partial markers and empty-root statements describe only the pinned analysis baseline.
The planned private slices and provider-neutral root API were later completed under ADR-0013 and ADR-0012. Codex remains an
internal provider; supported-cell declaration and active-process reconnection remain separate delivery decisions. -->

# t_exec-adapter-01 — Next provider-neutral execution slice: pre-spawn security substrate (v2)

- Role: analyst (analysis-only; no implementation; no file outside `docs/design/` touched by this role)
- Worktree: `/home/egor/work/dev/revo/revo-agent-runtime/.worktrees/analysis-execution-adapter-next-slice`
- Branch: `analysis/execution-adapter-next-slice`
- Worktree base / HEAD: `48fe66170a81a2a577b81395e739f4618313206e` ("docs: move public AgentManager export after
  first adapter (ADR-0012) (#39)")
- `origin/master` at analysis time: `bba988273c4b3cee79b7409be21b4622a1971273` ("feat(manager): hand off prepared
  launch evidence (#41)"), exactly one commit ahead of this worktree's base. Verified: `git merge-base --is-ancestor
bba9882 HEAD` → `no`; `git log origin/master --oneline -2` → `bba9882 ... (#41)` then `48fe661 ... (#39)`.
- Discovery method: direct source/doc reading plus targeted read-only verification commands (`typecheck`, unit/
  contract/integration/package test lanes, `test:cov`, `verify:architecture`, `verify:package`, `format:check`,
  `lint`) run against the current worktree state. No file was modified by this role. `.codegraph/` is still absent
  at or above this worktree (confirmed again this session), so this remains the documented codegraph fallback.

---

## 0. What changed since v1, in one paragraph

Two things happened between v1 and this v2. First, PR #41 merged `PreparedLaunch` into `origin/master`, one commit
ahead of this worktree's still-unrebased base — it threads a narrow `{ pin, executable, reportedVersion }` launch-
evidence record from manager preflight through `InvocationLifecycle` into `InvocationExecutionPorts['execution']
.start(snapshot, preparedLaunch)`. Second, the user reviewed v1's single-slice recommendation ("child-environment
capture alone") and explicitly decided the first developer slice must not stop there: it must ship one bounded,
provider-neutral **pre-spawn security substrate** covering child-environment capture, sealed secret registration,
complete chunk-safe streaming redaction (literal secrets **and** the built-in grammar — not a literal-only or whole-
chunk approximation), and a bounded redacting stdout/stderr guard. This directly reopens v1's own §4.1 candidate
table, which had ordered "streaming redaction core" strictly _after_ child-environment capture as a separate future
slice. That ordering is not wrong as a dependency fact (redaction's registration input still comes from environment
capture) — it is superseded as a _slicing_ decision: the user wants both delivered together, in dependency order,
inside one PR. This document reflects that decision; it does not re-litigate it.

---

## 1. Current-state reconciliation (updated for `bba9882` and the current dirty diff)

### 1.1 Stage identification — unchanged

`docs/roadmap.md:4` and the stage table/diagram (`docs/roadmap.md:288-294,300-338`) are byte-for-byte unchanged
between the worktree base and `origin/master` (`git diff 48fe661 bba9882 -- docs/roadmap.md` is empty). The current
in-flight stage is still "Real process, filesystem, security, cancellation, and shutdown conformance"
(`docs/roadmap.md:391-415`), whose **Owns** list names, verbatim: "real direct spawn and stdio ports; **explicit
environment capture; streaming redaction**; byte, item, queue, and retention bounds; workspace and output preflight;
exclusive output leaf; owner-only scratch; bounded event/stdout/stderr/raw files; non-replacing result publication;
idle/wall deadlines; cancellation; process-tree kill/reap confirmation; shutdown; and late-finalization failure
behavior" (`docs/roadmap.md:397-401`). This is the load-bearing citation for bundling parts 1–4 of this slice as one
named-together responsibility rather than four unrelated features.

### 1.2 Exit-criteria table — updated rows only (all other rows from v1 are unchanged; re-verified at `bba9882`)

| Exit-criteria item                     | v1 status        | **v2 status**                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit environment capture           | missing          | **shipped, not yet committed** (this worktree's dirty diff)     | `src/runtime/execution/child-environment/{child-environment-request,child-environment-capture,capture-child-environment,index}.ts`; behavior verified against every rule in v1 §3.3 (see §1.5 below); test `test/unit/runtime/execution/child-environment.test.ts` (14 cases, all passing at HEAD+diff, see §1.5).                                                                                                                                                                                                                                                                                                        |
| Real direct spawn / stdio ports        | partial (orphan) | **partial (orphan), plus a new narrow launch-evidence handoff** | `src/runtime/execution/prepared-launch.ts` (merged, `bba9882`) now carries `{ pin, executable, reportedVersion }` from manager preflight (`src/application/manager/lifecycle-manager.ts:186-222` in `bba9882`) through `InvocationLifecycle` (`lifecycle.ts:46,74` in `bba9882`) into `InvocationExecutionPorts['execution'].start(snapshot, preparedLaunch)` (`execution-ports.ts:8-11` in `bba9882`). The orphan-adapter gap from v1 is otherwise unchanged: no module implements `ProcessSupervisionPort → InvocationExecutionPorts['execution']`. See §2 below for why this narrow shape does not yet close that gap. |
| Streaming redaction                    | missing          | **still missing** (target of this slice, parts 2–4 below)       | No redaction behavior in `src/`. Manager-option validation of `redaction.secrets` is unchanged: `src/runtime/spec/manager-options/agent-manager-options.ts:17`, bounds `src/runtime/policy/limits/agent-runtime-limits.ts:24-25` (`redactionValues: 1_000`, `redactionTotalBytes: 65_536`). The normative algorithm (`docs/specs/agent-manager-v1.spec.md:1102-1145`) has no implementation.                                                                                                                                                                                                                              |
| Byte / item / queue / retention bounds | partial          | partial, unchanged                                              | Same evidence as v1. `maxStdoutBytes`/`maxStderrBytes` (`agent-manager-limits.ts:6-7`) are validated and defaulted through `validate-manager-options.ts:77-83,439-440` but have **no production consumer yet** — they exist for the future bounded output guard (part 4) and the later file-writer (Stage 4, excluded here).                                                                                                                                                                                                                                                                                              |

Everything else in v1's exit-criteria table (workspace preflight, output preflight, exclusive output leaf, owner-only
scratch, bounded files, idle deadline, wall deadline, cancellation, process-tree kill/reap, shutdown, late-
finalization) is re-verified unchanged at `bba9882` — `git diff 48fe661 bba9882` touches only the six files listed
in §1.2's second column below, none of which are those areas.

### 1.3 Exact files PR #41 changed (for rebase-risk assessment in §9)

```text
$ git diff 48fe661 bba9882 --stat
.oxlintrc.architecture.json                          |  2 +-
scripts/architecture/validate-module-structure.ts     |  3 +
scripts/verify-architecture.ts                        | 15 ++
src/application/manager/lifecycle-manager.ts          | 35 ++-
src/runtime/execution/execution-ports.ts               |  6 +-
src/runtime/execution/index.ts                         |  1 +
src/runtime/execution/lifecycle.ts                      |  4 +-
src/runtime/execution/prepared-launch.ts (new)          | 82 ++++
test/... (contract/support/unit test files)            | ~600 lines
```

None of these overlap with the files this worktree's dirty diff touches (§1.5), except `src/runtime/execution/
index.ts`, `test/types/runtime-module-structure.ts`, and `test/unit/runtime/module-structure.test.ts` — and even
there the edits land at different insertion points (PR #41 adds a `PreparedLaunch` export/pin near the existing
`InvocationLifecycle`/`ProcessExitObservation` alphabetical neighbors; the dirty diff adds a `child-environment`
export block near the top, before `execution-terminal-observation`). Confirmed by diffing both changesets against
the same base (`git diff 48fe661 bba9882 -- <file>` vs `git diff -- <file>` in the worktree): the changed line
ranges do not intersect in any of the three shared files. This is the concrete evidence behind §9's "straightforward
rebase" classification.

### 1.4 `PreparedLaunch` read directly (answers the assigned architecture question — see §2)

`src/runtime/execution/prepared-launch.ts` (merged, read at `origin/master:bba9882`): a sealed value class with
exactly three own fields — `pin: { agentId, agentVersion, definitionDigest }`, `executable: string`,
`reportedVersion: string`. `PreparedLaunch.create()` accepts only a plain object with **exactly** those keys
(`hasExactKeys`, own-property reflective reads, no prototype pollution) and rejects anything else, mirroring the
same hostile-input discipline as `input-snapshot.ts` and the child-environment capture. It is produced once, at
manager preflight, by `InternalInvocationLifecycleManager.preflight()` (`lifecycle-manager.ts:186-222` in `bba9882`)
from the executable-probe result, and is passed unchanged into `ports.execution.start(snapshot, preparedLaunch)`
(`lifecycle.ts:74` in `bba9882`). It carries **no** argv, no environment, no cwd, no protocol/permission/parser
strategy selection, and no output sinks. `InvocationInputSnapshot` (`input-snapshot.ts`, unchanged by `bba9882`)
still exposes only six fields — `agent`, `invocationId`, `metadata`, `resultSchema`, `wallClockTimeoutMs`,
`workspace` — and, critically, **no `prompt` and no `parameters`**, even though the normative
`AgentInvocationStartRequest` in `docs/specs/agent-manager-v1.spec.md:438,442` requires both. This is load-bearing
evidence for §2.

### 1.5 The current dirty diff, read in full (child-environment capture, already built and already green)

This worktree has an uncommitted, complete implementation of v1's recommended child-environment-capture slice:

```text
 M src/runtime/execution/index.ts             (+5, barrel exports)
 M src/runtime/execution/input-snapshot.ts     (+4/-32, extracts shared reflective-read helper)
 M test/types/runtime-module-structure.ts      (+45, type-surface pins)
 M test/unit/runtime/module-structure.test.ts  (+5, expected-file list)
?? src/runtime/execution/child-environment/    (4 new files)
?? src/runtime/execution/reflective-object-read.ts  (new shared helper, extracted from input-snapshot.ts)
?? test/unit/runtime/execution/child-environment.test.ts  (14 test cases)
```

Read in full:

- `child-environment-request.ts` — `{ inherit: readonly string[]; variables: Readonly<Record<string,string>>;
secrets: Readonly<Record<string,string>> }`.
- `child-environment-capture.ts` — discriminated union `{ status: 'captured', environment, secretValues } |
{ status: 'rejected', reason: <10-member enum> }`, matching the reason set the architect ratified in
  `t_exec-adapter-02` and v1 §3.10.
- `capture-child-environment.ts` — implements every rule from v1 §3.3 exactly: key-shape regex
  `^[A-Za-z_][A-Za-z0-9_]*$`; credential-like-name rejection via
  `/token|secret|password|credential|api[_-]?key|private[_-]?key/i` applied only to `inherit`/`variables` names,
  never `secrets`; duplicate detection across all three collections; missing-`inherit` rejection; empty-secret
  rejection; 128-key / 128-byte-key / 64 KiB-value / 256 KiB-total bounds (exact match to
  `docs/specs/agent-manager-v1.spec.md:1082-1084`); a frozen null-prototype output record; an ordered, de-duplicated
  `secretValues` array; and a top-level `try/catch` that converts any hostile reflective-access throw into
  `{ status: 'rejected', reason: 'invalid_request' }` — never an uncaught throw.
- `reflective-object-read.ts` — a new shared helper (`isPlainObservedObject`, `isDataDescriptor`,
  `isEnumerableDataDescriptor`, `ownEnumerableData`, `enumerableKeys`) extracted verbatim out of
  `input-snapshot.ts`'s pre-existing private helpers and now imported by both `input-snapshot.ts` and
  `capture-child-environment.ts`. This is a real, behavior-preserving refactor (not a rewrite): `input-snapshot.ts`'s
  own 30+ passing tests are unaffected because the extracted functions are byte-identical in behavior.
- `test/unit/runtime/execution/child-environment.test.ts` — 14 test cases covering every acceptance criterion in v1
  §3.9 **plus** hostile-input cases beyond v1's minimum (a throwing `ownKeys` trap on the `inherit` array, an
  accessor-property host snapshot, a throwing `getOwnPropertyDescriptor` trap, a non-dense array-like `inherit`, non-
  plain-object `variables`/`secrets`/top-level request, and an unexpected extra top-level key). This is a superset of
  what v1 required, not a subset.

**Read-only verification run by this analyst role against the current worktree state (no file was modified):**

| Command                                                                                                                                                                             | Result                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm typecheck`                                                                                                                                                           | pass, zero diagnostics                                                                                                                                                                                         |
| `corepack pnpm run format:check`                                                                                                                                                    | pass, all 232 files correctly formatted                                                                                                                                                                        |
| `corepack pnpm run lint`                                                                                                                                                            | pass, zero warnings/errors                                                                                                                                                                                     |
| `corepack pnpm exec vitest run test/unit/runtime/execution/child-environment.test.ts test/unit/runtime/module-structure.test.ts test/unit/runtime/execution/input-snapshot.test.ts` | 3 files, 30 tests, all pass                                                                                                                                                                                    |
| `corepack pnpm run test:contract`                                                                                                                                                   | 8 files, 63 tests, all pass                                                                                                                                                                                    |
| `corepack pnpm run test:integration`                                                                                                                                                | 1 file, 8 tests, all pass                                                                                                                                                                                      |
| `corepack pnpm run test:package`                                                                                                                                                    | 1 file, 2 tests, all pass                                                                                                                                                                                      |
| `corepack pnpm run test:cov`                                                                                                                                                        | 46 files, 556 tests, all pass; coverage 94.81% stmts / 90.71% branches / 98.91% funcs / 97.44% lines — every threshold (80/90/90/90) exceeded; new `child-environment/` leaf itself at 95.71%/91.25%/100%/100% |
| `corepack pnpm run test:architecture`                                                                                                                                               | "Architecture validation passed (positive graph and negative probes)."                                                                                                                                         |
| `corepack pnpm run verify:package`                                                                                                                                                  | pass — build, `publint`, ATTW, exact-tarball ESM/types/deep-import proof all green                                                                                                                             |

**This is the complete `pnpm verify` gate, run piece-by-piece, and it is green on the current dirty diff at this
base.** This is the central evidence behind §8's "retain unchanged" classification for every file in the dirty diff.

### 1.6 Reconciliation against the roadmap boundary — unchanged from v1

Ahead-of-boundary and behind-boundary findings from v1 §1.4 are unchanged and re-cited, not repeated in full here:
the Codex argv/permission/JSONL slices remain conforming "captured bounded fixtures" prep (`docs/roadmap.md:250`,
negative leak check unchanged); Stage 3 remains open (shutdown/idle/cancellation-against-fakes gaps unchanged); the
"no production composition root" structural gap is unchanged; and the contract gap that blocks the generic adapter
seam is now _partially_ addressed (`PreparedLaunch` exists) but **not closed** — see §2.

---

## 2. Architecture question: does the next real-execution adapter need a separate `ExecutionPlan`/`PreparedExecution` handoff?

This was assigned as "analyze, not silently decide." Answer, with evidence, below.

### 2.1 What `PreparedLaunch` already provides

Exactly `{ pin: { agentId, agentVersion, definitionDigest }, executable, reportedVersion }` (§1.4). This is launch
**evidence** — proof that a specific resolved executable at a specific reported version matches a specific pinned
definition digest, captured once at preflight time. It answers "what proved runnable, and against which pinned
definition" — nothing about "how to invoke it."

### 2.2 What a generic execution adapter additionally needs to call `ProcessStartRequest`

`ProcessStartRequest` (`src/runtime/execution/process-supervision-port/process-start-request.ts:3-11`, unchanged by
`bba9882`) requires `cwd`, `executable`, `args: readonly string[]`, `environment: Readonly<Record<string,string>>`,
`shell: false`, and `stdout`/`stderr: ProcessOutputSink`. Building that request from `(snapshot, preparedLaunch)`
needs, at minimum:

1. **Resolved argv.** `strategies/permissions/codex/codex-argument-builder.ts:3-9` shows the shape a real builder
   needs: `sandbox`, `network`, `allowDangerFullAccess?`, `prompt: string`, `model?`, `outputSchema?`. **None of
   `prompt` or a `parameters`/model/schema-derived value exists on `InvocationInputSnapshot` today** (§1.4). The
   normative `AgentInvocationStartRequest` (`docs/specs/agent-manager-v1.spec.md:438,442`) requires both `prompt:
string` and `parameters: JsonObject`; `input-snapshot.ts`'s own `readRequest()` allowlist (six keys) would
   currently **reject** an input object carrying either one. This is a real, separately-scoped gap in the snapshot
   itself, not just in `PreparedLaunch`.
2. **A resolved child environment** — the output of `captureChildEnvironment()` (this slice's part 1), which
   `PreparedLaunch` does not carry and `InvocationInputSnapshot` must never carry (v1 §3.4, `docs/architecture.md:
271-277`, `REVIEW.md:17-18`: the environment is deliberately ephemeral start-context, not a durable snapshot
   field).
3. **Redacted, bounded `stdout`/`stderr` sinks** (this slice's parts 2–4) satisfying `ProcessOutputSink`.
4. **A resolved `cwd`** from `snapshot.workspace`, and a **protocol/parser/permission strategy selection** (native
   stdio vs. ACP; which provider's argument builder and result parser apply) — none of which any of `snapshot`,
   `preparedLaunch`, or the registry's sealed definition currently expose as one coherent, already-selected value at
   the point `ports.execution.start()` is called.

### 2.3 Conclusion

**Yes — the evidence supports that the next real-execution-adapter slice will need a new, separate, immutable
handoff artifact** (working name `ExecutionPlan` or `PreparedExecution`) distinct from `PreparedLaunch`, carrying at
minimum resolved argv, the selected protocol/permission/parser strategy, and a resolved `cwd` — assembled from a
`snapshot` that itself will likely need new fields (`prompt`, `parameters`) it does not have today. This is **not**
proven to be a small or a purely additive change: it may require revisiting `InvocationInputSnapshot`'s six-field
allowlist, which is exactly the kind of boundary/contract/data-model decision this analyst role must not resolve
inside an analysis artifact (`references/core.md`: "mark architecture uncertainty as `needs_architect` instead of
resolving it inside analysis").

**This handoff is explicitly NOT added to this slice.** None of the four security-substrate parts below need
`prompt`, `parameters`, argv, cwd, or strategy selection — they operate on host-snapshot-shaped input, secret value
lists, and raw byte chunks only. The dependency is one-directional and satisfied later: the future
`ExecutionPlan`/adapter slice will _consume_ this slice's `ChildEnvironmentCapture` and the redacting-guard factory;
this slice does not need to anticipate the plan's shape to be complete and correct on its own. See §11 for the
suggested next architect task title.

---

## 3. Revised bounded responsibility — the pre-spawn security substrate (4 parts)

### 3.1 One-sentence responsibility

Implement one private, provider-neutral pre-spawn security substrate in `src/runtime/execution/` that (1) turns an
untrusted consumer environment request into one frozen child environment plus an ordered invocation-secret list, (2)
combines that list with configured redaction secrets into one sealed, immutable per-invocation secret registration,
(3) redacts secret values — both exact literals and the normative built-in grammar — from arbitrary byte chunks with
independent per-channel state, leftmost-longest matching, bounded carry, and explicit final flush, and (4) wraps an
injected byte destination in a bounded, redacting guard that enforces a byte limit and a deterministic truncation
signal before any byte reaches that destination — with no filesystem, no real process, and no manager/application
wiring anywhere in the four parts.

### 3.2 Why these four parts are one bounded slice, not four

- All four are named together in the current in-flight stage's **Owns** list (§1.1): "explicit environment capture;
  streaming redaction; byte, item, queue, and retention bounds" are the same sentence in `docs/roadmap.md:397-401`.
- `REVIEW.md:66-68` is one blocking-findings bullet covering exactly this substrate: "A child inherits wholesale
  `process.env`, environment keys overlap, secret values are not registered with streaming redaction before spawn,
  credential-like names enter nonsecret inherit/variables, or unredacted carry buffers survive finalization." Parts
  1–4 are the complete, non-overlapping decomposition of that one sentence: part 1 prevents wholesale-inheritance and
  key-overlap; part 2 is the "registered ... before spawn" clause; part 3 is the "streaming redaction" and "carry
  buffers" clauses; part 4 is the enforcement point ("before spawn") wired as a reusable guard.
- Splitting part 1 from parts 2–4 (as v1 recommended) is safe in dependency-graph terms but leaves the single
  highest-severity review blocker (`REVIEW.md:66-68`) **half-closed**: a shipped, tested environment-capture module
  with no registration or redaction downstream is a named security control with no enforcement path, which is worse
  optics than shipping neither, even though it is not itself unsafe (nothing consumes it yet — see §1.5's
  confirmation that the dirty diff has zero production callers today). The user's scope correction closes the
  blocker completely in one slice instead of leaving it half-closed across two PRs.
- Every part remains **pure**: no filesystem, no `child_process`, no clock, no network, no OS-identity read. This
  matches `docs/roadmap.md:409`'s constraint that this stage's work must proceed "without declaring a supported
  platform cell" and needs no real-process fixture, exactly as v1 established for part 1 alone.
- Its normative contract is **already closed by approved decisions** for all four parts: `docs/specs/agent-manager-
v1.spec.md:547-562` (environment), `:1082-1085` (environment and configured-secret bounds), `:1102-1145`
  (redaction algorithm, carry, overflow, flush, truncation) — no new human/product decision is required to start.

### 3.3 Included behavior

**Part 1 — Child-environment capture.** Unchanged from v1 §3.3 items 1–10, already implemented in the dirty diff
(§1.5). Retained verbatim as the contract; no behavior change proposed.

**Part 2 — Sealed secret registration** (new):

1. Accept two already-independently-bounded inputs: `configuredSecrets: readonly string[]` (the manager's static
   `redaction.secrets`, already validated to at most 1,000 values / 65,536 bytes total by `validate-manager-
options.ts:98-100` and bounded by `AGENT_RUNTIME_LIMITS.redactionValues`/`redactionTotalBytes`,
   `agent-runtime-limits.ts:24-25`) and `invocationSecrets: readonly string[]` (`ChildEnvironmentCapture.
secretValues`, already bounded transitively by part 1's 128-key/256 KiB environment bounds).
2. Defensively validate each element is a non-empty string (reject a non-array, a non-string element, or an empty-
   string element with a typed reason — this is a structural boundary re-check, not a new numeric bound; see §10.1
   for why no new combined numeric ceiling is invented here).
3. Combine both lists **in order** (configured first, then invocation), removing exact-value duplicates while
   preserving first-seen order — this is a **value-level deduplication**, not a name/key check: unlike part 1's
   duplicate-_name_ rejection, a secret value appearing in both the configured list and an invocation's `secrets`
   is an expected, harmless overlap (e.g., a long-lived provider token configured once and also passed per
   invocation), so it is silently deduplicated, never rejected. This distinction must not be blurred with part 1's
   duplicate-_name_ rejection rule, which is a different check over different data (environment key names, not
   secret values).
4. Produce one frozen, immutable `secretValues: readonly string[]` result — the "sealed registration" — with **no**
   method to add a secret afterward (no mutable late-registration API, matching the brief verbatim).
5. Return a discriminated result (`{ status: 'registered', secretValues } | { status: 'rejected', reason }`), never
   throwing, mirroring part 1's failure-handling discipline.
6. **Ordering constraint enforced by composition-root discipline, not by the type system:** the future redacting-guard
   factory (part 4) takes a `secretValues` value as a required constructor parameter, sourced from a
   `SealedSecretRegistration`. That parameter, and part 3's `createRedactionChannel(secretValues)` parameter, are both
   typed as plain `readonly string[]` — a bare, unbranded array type. Nothing in that type stops a caller from passing
   an ad-hoc array literal instead of `registerSecrets()`'s output; TypeScript structural typing accepts either one
   identically. The ordering "registration must complete before any stdout/stderr sink or future spawn can exist" is
   therefore satisfied only by **composition-root discipline** — every real call site must thread
   `SealedSecretRegistration.secretValues` through, never construct a raw literal — not by the type system. See §10.5
   for why this slice does not close that gap with a branded type, and for the residual risk this leaves for the next
   slice's composition-root author.

**Part 3 — Complete chunk-safe streaming redaction** (new), implementing `docs/specs/agent-manager-v1.spec.md:
1102-1145` in full:

1. Independent state per channel: two separately constructed instances (one for `stdout`, one for `stderr`), each
   with its own undecided-candidate carry buffer, never sharing state.
2. Exact-literal matching of every registered secret value as its precise UTF-8 byte sequence — no normalization,
   decoding substitution, or case folding (`:1103`).
3. The complete built-in byte-oriented grammar (`:1106-1128`): `KEY-VALUE` for the allowlisted keys `API_KEY`,
   `API_TOKEN`, `ACCESS_TOKEN`, `AUTH_TOKEN`, `CLIENT_SECRET`, `PASSWORD` (ASCII case-insensitive key match only;
   unquoted/double-quoted/single-quoted value forms); `HEADER` for `Authorization`/`Proxy-Authorization` (ASCII
   case-insensitive); bare `BEARER` token replacement; and `PEM` block replacement bounded to 128 UTF-8 bytes per
   delimiter. This is **not optional** — the brief is explicit that "no literal-only or whole-chunk approximation"
   satisfies the requirement.
4. Leftmost-longest overlap resolution at one start offset, applied uniformly to literal and built-in candidates
   together (`:1130-1131`).
5. At most 64 KiB of undecided candidate bytes retained per channel (`:1132`); on that limit being exceeded by a
   malformed/unterminated built-in candidate, emit exactly one `[REDACTED]`, enter discard-until-delimiter state,
   and discard every further candidate byte without writing it downstream until the applicable safe delimiter is
   observed or the channel ends (`:1136-1140`).
6. Final flush: a remaining in-carry-limit candidate is emitted as its permitted structural prefix plus exactly one
   `[REDACTED]`; a discard-state channel emits no additional marker at flush (`:1143-1144`).
7. Explicit `dispose()`/clear on every channel instance: best-effort clears the carry buffer and any retained secret-
   value byte copies used for matching. Idempotent — safe to call more than once. After `dispose()`, `feed()`/
   `flush()` fail closed (throw a stable, typed error) rather than silently continuing to process bytes — see §10.3
   for why this, not a silent no-op, is the correct contract.

**Part 4 — Internal bounded redacting stdout/stderr guard** (new):

1. Wraps exactly one injected downstream `ProcessOutputSink` (`write(chunk): Promise<void>; end(): Promise<void>`,
   `process-output-sink.ts:1-4`, unchanged) and produces another object satisfying that same interface — so a
   future adapter can assign it directly to `ProcessStartRequest.stdout`/`.stderr` with no widening of that existing
   type.
2. Internally owns one part-3 redaction channel, constructed from a part-2 sealed registration's `secretValues` —
   enforcing part 2's "before any stdout/stderr sink ... can exist" ordering constraint by construction.
3. Enforces one canonical byte bound (`maxBytes`, injected as a parameter — not hardcoded and not read from policy
   directly by this pure module; see §10.2) over the **redacted** output stream, not the raw input stream.
4. Produces a deterministic, queryable truncation signal once that bound is reached, and stops forwarding further
   bytes to the downstream sink from that point on (still safely draining/disposing its own internal state). Once
   signaled, truncation is a **one-way, terminal, byte-forwarding-stop state**: no further byte — including any byte
   that a subsequent final flush would otherwise produce — is ever forwarded downstream, for the remaining lifetime
   of the guard. See §10.2 for why the signal itself is a boolean accessor rather than an in-band literal marker
   written into the byte stream.
5. `end()` triggers the channel's final flush (part 3 item 6) and forwards its output before ending the downstream
   sink, then disposes the channel — **unless truncation was already signaled before `end()` is called**, in which
   case `end()` only completes bookkeeping and disposal: it still runs the channel's final flush internally (so the
   channel's own state is fully retired) and still ends and disposes the downstream sink, but forwards none of the
   flush's output — per item 4, truncation already stopped byte-forwarding, and `end()` after truncation must not
   reopen it.
6. Explicit `dispose()`, independent of `end()`, for failure/cancellation paths where a downstream sink never
   completes normally — delegates to the internal channel's `dispose()`. Idempotent.
7. Does **not** implement a filesystem writer, does **not** decide retention or publication, and does **not** know
   about `stdout.log`/`stderr.log`/`.scratch` — those remain Stage 4 (excluded, §3.4).

### 3.4 Excluded behavior (unchanged list plus explicit confirmations for the new parts)

- Reading real `process.env` (still a future `platform/process` mechanical concern; still not this slice).
- Constructing or throwing `AgentManagerError` / emitting `revo.agent.environment_invalid` or any other fault code —
  every part of this slice returns typed results or exposes typed state; fault mapping is a manager/preflight
  concern, unchanged from v1.
- Spawning, argv construction, executable resolution, cwd selection, protocol/permission/parser strategy selection
  — see §2; explicitly the next slice's responsibility, not this one's.
- Adding `environment`, `secretValues`, or any registration/redaction state to `InvocationInputSnapshot` or to any
  active/completed/persisted record. The security substrate's state is invocation-scoped and ephemeral by
  construction; it never crosses a durable boundary (`docs/architecture.md:271-277`, `REVIEW.md:17-18`).
- Any real filesystem write, `.scratch`, `stdout.log`/`stderr.log`/`events.ndjson`/`result.json`, output leaf claim,
  idle deadline, manager shutdown, active-state sink, or public export — unchanged from v1, and explicitly excluded
  from parts 2–4 as well: the redacting guard's downstream `ProcessOutputSink` is _injected_, never constructed by
  this slice, so no part of this slice ever touches a real file descriptor.
- Any Codex, Claude, ACP, or other provider-specific behavior in any of the four parts.
- Manager/application composition wiring of any of the four parts into `InternalInvocationLifecycleManager`,
  `InvocationLifecycle`, or any `platform/` adapter. This slice ships four additive, uncalled-in-production modules,
  exactly like part 1 already is today (§1.5: zero production consumers, confirmed by the same grep discipline v1
  used).

### 3.5 Owning modules and layers

All four parts live under `src/runtime/execution/`, extending the architect's ratified D1 decision
(`t_exec-adapter-02`: "explicit child-environment capture is a pure function owned by `runtime/execution`... no new
`HostEnvironmentPort`") to the same layer for the same reason: `docs/architecture.md:138` already states
`runtime/execution` owns "input snapshots, bounded argv, one state machine, result validation, **ports**, and
finalization," and none of parts 2–4 needs a Node API, OS call, or filesystem access — they are pure
byte/string-processing functions and one pure decorator over an _existing_ port shape (`ProcessOutputSink`). No new
port is introduced for any of the three new parts, applying the same reasoning D1 already established: `AGENTS.md`
("add abstractions only for an existing boundary, variation, or test seam") argues against a new port when there is
exactly one pure implementation and no current variation. `platform/process` remains the layer that will later feed
real bytes into part 4's guard and a real captured `process.env` into part 1's capture — neither of those platform-
side wirings is this slice's job.

```text
src/runtime/execution/
├── child-environment/                        # PART 1 — already built (dirty diff, retained, §8)
│   ├── child-environment-request.ts
│   ├── child-environment-capture.ts
│   ├── capture-child-environment.ts
│   └── index.ts
├── secret-registration/                      # PART 2 — new
│   ├── secret-registration-request.ts        # type: { configuredSecrets, invocationSecrets }
│   ├── sealed-secret-registration.ts         # type: registered | rejected discriminated result
│   ├── register-secrets.ts                   # the one exported behavior: registerSecrets(request)
│   └── index.ts
├── redaction/                                 # PART 3 — new
│   ├── redaction-channel.ts                  # type: RedactionChannel { feed, flush, dispose }
│   ├── create-redaction-channel.ts           # the one exported behavior: createRedactionChannel(secretValues)
│   └── index.ts
├── redacting-output-guard/                    # PART 4 — new
│   ├── redacting-output-guard-request.ts     # type: { downstream, secretValues, maxBytes }
│   ├── redacting-bounded-output-sink.ts       # type: RedactingBoundedOutputSink extends ProcessOutputSink { dispose(), truncated() }
│   ├── create-redacting-bounded-output-sink.ts  # the one exported behavior
│   └── index.ts
└── reflective-object-read.ts                  # already extracted (dirty diff, retained) — reused by parts 2–4
                                                 # wherever a request object needs defensive reflective reads
```

One entity per leaf, matching `docs/specs/internal-module-structure.spec.md:212-214` and the existing
`*-port/`-style domain-folder convention already used inside `runtime/execution` (`bounded-command-port/`,
`process-supervision-port/`, and now `child-environment/`). Verb-first behavior-file naming
(`capture-child-environment.ts`, `register-secrets.ts`, `create-redaction-channel.ts`,
`create-redacting-bounded-output-sink.ts`) matches the one convention already established by the dirty diff.

### 3.6 Dependency graph (updated)

```text
runtime/execution (existing: InvocationInputSnapshot, execution-ports, lifecycle, ProcessOutputSink, PreparedLaunch)
        |
        v
(1) child-environment capture [S, dirty-diff, green]  --------------------------\
        |                                                                       |
        | secretValues                                                          |
        v                                                                       |
(2) secret registration [M, this slice]  <---- configuredSecrets (manager options, already validated, unwired input)
        |                                                                       |
        | secretValues (sealed)                                                 |
        v                                                                       |
(3) streaming redaction channel [M, this slice] (independent stdout/stderr instances)
        |                                                                       |
        v                                                                       |
(4) bounded redacting output guard [M, this slice] (wraps injected ProcessOutputSink)
        |                                                                       |
        v                                                                       |
   >>> future execution-plan / argv / strategy-selection handoff [M, NEXT SLICE, §2] <<<
        |
        v
   future provider-neutral real-process adapter [M, NEXT SLICE, §11]
   (ProcessSupervisionPort -> InvocationExecutionPorts['execution'], consumes (1)-(4) and the future plan)
        |
        v
   application composition root [P] (createAgentManager, platform-adapter wiring — still M)
        |
        v
   Native Codex adapter conformance + supported-cell closure [M]
        |
        v
   public root export (ADR-0012) [M at this historical baseline] -> src/index.ts stayed `export {}`
```

Node legend unchanged from v1: `[S]` shipped+tested (in this worktree, uncommitted) · `[M]` missing/target ·
`[P]` partially shipped.

Ordering constraints:

1. (2) requires (1)'s `secretValues` output as one of its two inputs; the other input (`configuredSecrets`) is
   already available from existing, already-shipped manager-option validation — it is a pure value, no new
   dependency to build.
2. (3) requires (2)'s sealed `secretValues` — this is the type-level ordering constraint from §3.3 part 2 item 6.
3. (4) requires (3) (constructs one channel internally) and an already-existing `ProcessOutputSink`-shaped injected
   destination (satisfied by any test fake today; satisfied by a real platform sink only in the next slice).
4. The future execution-plan/adapter slice requires (1)-(4) plus new snapshot fields (`prompt`, `parameters`) and a
   new strategy-selection mechanism — none of which exists yet (§2). This slice does not block on that gap; it is
   simply not consumed by anything yet, exactly as (1) is not consumed by anything yet today (§1.5).
5. **§4's test-writing order deliberately differs from this production dependency order.** RED2 (the redaction
   channel, part 3) is written and made green before RED3 (secret registration, part 2), even though production data
   flows (2)→(3) above. This is intentional, not a slip: `createRedactionChannel` takes a bare `secretValues:
readonly string[]` constructor parameter, not a `SealedSecretRegistration` object, so the channel has no real code
   dependency on part 2's output shape — only on an array of strings, which any test can supply directly without
   registration existing yet. Stating this here removes the need for the reader to infer it from the RED numbering.

### 3.7 Affected existing symbols and call paths

Unchanged from v1's finding for part 1: **the whole slice remains additive.** No modification to
`InvocationInputSnapshot`, `InvocationLifecycle`, `InvocationExecutionPorts`, `PreparedLaunch`, any `platform/`
adapter, any `strategies/`, `src/index.ts`, or `package.json` is required to ship parts 1–4. Registration files that
must be updated or the module-structure/type-surface gates fail:

- `src/runtime/execution/index.ts` — add three more barrel export blocks (secret-registration, redaction,
  redacting-output-guard), following the exact pattern the dirty diff already used for `child-environment` (§1.5).
- `test/unit/runtime/module-structure.test.ts` — extend the expected-file list with the **11 new files across the
  three new domain folders** (matching §3.5's tree exactly: `secret-registration/` 4 files, `redaction/` 3 files,
  `redacting-output-guard/` 4 files — 8 non-barrel entities total), following the same alphabetical-insertion pattern
  the dirty diff already used.
- `test/types/runtime-module-structure.ts` — add exact type-surface pins for `SecretRegistrationRequest`,
  `SealedSecretRegistration`, `registerSecrets`, `RedactionChannel`, `createRedactionChannel`,
  `RedactingOutputGuardRequest`, `RedactingBoundedOutputSink`, `createRedactingBoundedOutputSink` — following the
  exact `Expect<Equal<...>>` pattern the dirty diff already used for the child-environment types (§1.5, lines
  ~223-260 of that file's current diff).

---

## 4. TDD and RED/GREEN sequence

Ordered, independently executable, matching the seven REDs the brief requires. RED1 is already satisfied by the
dirty diff (retained, not re-done); RED2–RED7 are new. Each RED must be watched failing for the stated reason before
its GREEN, per `superpowers:test-driven-development` — this is a developer-phase obligation, recorded here as the
required sequence, not executed by this analyst role.

**RED1 — environment capture/bounds/snapshot.** _Status: already satisfied by the dirty diff_ (§1.5). The developer
must re-verify RED1 is still red-for-the-right-reason only if the rebase in §9 requires touching
`child-environment/**` — evidence in §1.5 and §8 shows it currently does not.

**RED2 — literal and built-in-grammar redaction matching (single chunk, then the mandatory split case).**
`test/unit/runtime/execution/redaction-channel.test.ts`:

- The mandatory first case verbatim: registered secret `abc123`; feed chunk `prefix abc`, observe no output bytes
  released yet (the candidate is still undecided); feed chunk `123 suffix`; the channel's cumulative released output
  equals exactly `prefix [REDACTED] suffix` — no raw chunk and no partial secret ever reaches the caller.
- Single-chunk baseline cases for the built-in grammar: `API_KEY=abcdef` (unquoted), `client_secret: "value with spaces"`
  (double-quoted, case-insensitive key), `Authorization: Bearer eyJhbGciOi...` (header form), bare
  `Bearer sometoken` outside a header, and one complete `-----BEGIN RSA PRIVATE KEY-----...-----END RSA PRIVATE
KEY-----` block — each redacted per its own structural rule (key-value retains key+separator; header replaces
  full value; bare bearer replaces only the token; PEM replaces the complete block).
- A case proving `TOKEN`, `SECRET`, `CREDENTIAL`, `PASSWORD_HASH`, `X_API_KEY`, `API_KEY_ID`, and
  `CLIENT_SECRET_VALUE` are **not** built-in-grammar matches (substring/synonym forms explicitly excluded by
  `:1121-1122`) — proving the grammar is not over-broad.
  This RED fails because the module does not exist; it is the anchor case the brief names explicitly.

**RED3 — secret combination/dedup/ordering.** `test/unit/runtime/execution/secret-registration.test.ts`:

- Configured `['A', 'B']` + invocation `['B', 'C']` → registered `secretValues` equals `['A', 'B', 'C']` (value-level
  dedup, first-seen order preserved, configured-first ordering).
- An empty-string entry in either list is rejected with a typed reason; a non-array input is rejected with a typed
  reason.
- A non-string top-level element in either list (e.g. a number, `null`, or a nested object/array) is rejected with a
  typed reason, and that reason contains no representation of the rejected element — extending §6's secret-leak
  invariant to a non-string rejection path, not just the empty-string case.
- The registration cannot be mutated after creation (frozen array; no `add`/`register` method exists on the result
  type — a type-level assertion, not just a runtime one).

**RED4 — independent stdout/stderr channel state.** Extends `redaction-channel.test.ts`:

- Two channel instances created from the same `secretValues`; feeding a split secret's first half into the stdout
  instance and the second half into the stderr instance must **not** combine into a match in either channel — each
  channel's carry buffer is provably independent (neither channel emits `[REDACTED]`; both eventually flush their own
  half unredacted, since the mandated case in RED2 requires both halves to land in the _same_ channel to redact).

Each RED below (including the 5a/5b and 6a/6b sub-steps) keeps its own one-GREEN-per-RED boundary: the sub-step split
does not merge two REDs into one GREEN, it only makes explicit that the channel-level and guard-level halves of the
original RED5/RED6 are independently red-then-green, matching this document's own stated rule that "each RED must be
watched failing for the stated reason before its GREEN."

**RED5a — carry/overflow/final-flush/leftmost-longest (channel-level).** Extends `redaction-channel.test.ts`:

- A candidate that would exceed the 64 KiB per-channel carry limit triggers exactly one `[REDACTED]`, then discards
  every further candidate byte until the applicable safe delimiter, then resumes normal matching — proven for at
  least the unquoted-key-value form (delimiter: WSP/comma/semicolon/ampersand/CR/LF) and the PEM form (delimiter:
  matching complete END delimiter).
- A candidate still within the carry limit at channel end is flushed as its permitted structural prefix plus exactly
  one `[REDACTED]`; a channel already in discard state at end emits no additional marker.
- Leftmost-longest resolution: an input containing both a literal secret and an overlapping built-in-grammar
  candidate starting at the same offset resolves to the longer match.

**RED5b — bounded guard's `maxBytes`/truncation (guard-level).** Adds
`test/unit/runtime/execution/redacting-output-guard.test.ts`:

- Feeding bytes past the guard's configured `maxBytes` (post-redaction) stops forwarding further bytes to a fake
  downstream sink, and the guard's truncation accessor becomes `true` exactly once that bound is crossed, never
  before.
- **`end()`-after-truncation (§3.3 part 4 items 4-5):** once the guard's truncation accessor is already `true`,
  calling `end()` forwards no further byte to the downstream sink (the channel's final flush is run internally but
  its output is discarded, never written) — proven by asserting the fake downstream sink's cumulative received bytes
  are unchanged by the `end()` call — while `end()` still ends and disposes both the downstream sink and the internal
  channel.

**RED6a — channel-level dispose/fail-closed.** Extends `redaction-channel.test.ts`:

- Calling `dispose()` on a channel is idempotent (no throw on a second call).
- After `dispose()`, a further `feed()` or `flush()` call throws a stable, documented error rather than silently
  continuing to process or emit bytes (fail-closed, matching the repository's "never swallow errors silently" rule).

**RED6b — guard-level "dispose invoked exactly once across 3 paths".** Extends
`redacting-output-guard.test.ts`:

- Using an injected test-double channel factory (default-parameter dependency injection, mirroring
  `InvocationLifecycle`'s existing `resultSchemaValidator` default-parameter pattern at `lifecycle.ts:49`), prove the
  guard's `dispose()` is invoked exactly once in each of: normal `end()` completion, a downstream sink `write()`
  rejection, and truncation being reached — three separate test cases, one per path.

**RED7 — architecture/module-structure proof.** No new test file; extends the existing architecture/module-
structure gates:

- `test/unit/runtime/module-structure.test.ts` and `test/types/runtime-module-structure.ts` updated per §3.7 (**11
  files, 8 entities** across the three new domains).
- `corepack pnpm run test:architecture` continues to pass with the three new domains present, proving no forbidden
  edge is introduced: `runtime/execution` still does not import `platform`, `strategies`, or `application`; the new
  domains do not import each other's siblings' internals (only through each domain's own `index.ts` barrel, matching
  the existing convention); no `export *`; `.js` specifiers everywhere.

---

## 5. Observable acceptance criteria (by part)

**Part 1** — unchanged from v1 §3.9, already proven (§1.5).

**Part 2:**

1. The combined `secretValues` list contains every distinct value from both inputs exactly once, in configured-
   then-invocation, first-seen order.
2. A value appearing in both inputs appears exactly once in the output (dedup, not rejection).
3. An empty-string entry in either input is rejected with a typed reason and produces no partial registration.
4. The result is frozen; no method on the result type can add a further secret.
5. A non-string top-level element in either input list is rejected with a typed reason that contains no
   representation of the rejected value — extending item 3's typed-rejection guarantee to non-string elements, not
   just empty strings.

**Part 3:**

1. A secret split across any two-chunk boundary is fully redacted in the combined output stream; no raw fragment of
   the secret ever appears in any single `feed()` return value.
2. Every built-in grammar form in `:1106-1128` is redacted per its own structural rule; every excluded synonym/
   substring form in `:1121-1122` is left unredacted.
3. stdout and stderr channels never share matching state.
4. A carry-limit overflow emits exactly one `[REDACTED]` and enters discard-until-delimiter, never partially
   emitting the candidate's raw bytes.
5. Final flush emits at most one further `[REDACTED]` for a remaining in-limit candidate, and none for a discard-
   state channel.
6. After `dispose()`, no further byte processing occurs; a second `dispose()` call does not throw.

**Part 4:**

1. The guard satisfies `ProcessOutputSink` structurally with no change to that interface's declared shape.
2. No byte is ever forwarded to the downstream sink before passing through the internal redaction channel.
3. Once redacted output has reached `maxBytes`, no further byte is forwarded downstream and the truncation accessor
   is `true`; before that point it is `false`.
4. `end()` flushes the channel, ends the downstream sink, and disposes the channel, in that order.
5. `dispose()` is safe to call independently of `end()` and is idempotent.
6. Constructing the guard requires an already-produced `secretValues` list (part 2's output) as a required
   parameter — there is no constructor overload that omits it.
7. Calling `end()` after truncation has already been signaled forwards no further byte downstream: the channel's
   final flush still runs internally, but its output is discarded, never written to the downstream sink; `end()`
   still ends and disposes the downstream sink and the channel.

---

## 6. Failure, cleanup, and secret-erasure requirements

Every failure across all four parts is a typed result or a stable thrown error after disposal — never a silent drop
(`AGENTS.md`: "Model expected failures explicitly with typed results or errors. Never swallow errors silently.").
Specifically:

- Parts 1 and 2 return discriminated typed results (`captured`/`rejected`, `registered`/`rejected`); neither ever
  throws for validation failure. Hostile reflective-access throws are caught at the boundary and converted to a
  rejection (already proven for part 1 in §1.5; required for part 2's structural validation in the same style).
- Part 3's channel operations (`feed`, `flush`) do not themselves model rejection — malformed input bytes are simply
  bytes; the channel's only "failure" mode is the carry-overflow discard path (§3.3 part 3 item 5), which is
  explicitly **not** a failure of the invocation (`:1141`: "neither persists a candidate tail nor fails the
  invocation") and must not be modeled as one.
- Part 3 and part 4 clearing (RED6): best-effort clearing of the carry buffer and any retained secret-value byte
  copies used internally for matching happens in `dispose()`, called by the guard on every finalization path (§3.3
  part 4 items 5–6). This satisfies `docs/specs/agent-manager-v1.spec.md:1144-1145`'s "best-effort clears mutable
  carry buffers and invocation secret copies" for the pieces this slice owns; it does not (and per the spec's own
  "best-effort" qualifier, cannot) provide a stronger guarantee than JavaScript's string/typed-array memory model
  allows — see §10.3.
- No rejection reason, error message, or thrown-error payload may contain a raw secret value or a raw environment
  value, across all four parts — extending part 1's already-proven rule (§1.5, "produces the ordered, de-duplicated
  list of secret values without leaking a value in a rejection") to parts 2–4.
- No cancellation or async cleanup path exists in parts 1–3 (fully synchronous, no I/O). Part 4's `write()`/`end()`
  are `Promise`-returning only because `ProcessOutputSink` requires it structurally; internally, redaction and
  bound-checking remain synchronous, and only the downstream sink call is genuinely asynchronous.

---

## 7. Verification matrix

| Proof                                        | Scope                                                                                                                                                                             | Command                                                                               | Applicability                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| RED1                                         | already satisfied (part 1)                                                                                                                                                        | `corepack pnpm exec vitest run test/unit/runtime/execution/child-environment.test.ts` | Required, already green                           |
| RED2–RED6                                    | parts 2–4, all new unit cases                                                                                                                                                     | `corepack pnpm run test:unit`                                                         | Required                                          |
| Contract proof                               | **Not applicable.** None of the four parts has manager-level observable behavior until a future adapter consumes them; a contract test now would assert an implementation detail. | —                                                                                     | Not applicable                                    |
| Real-process / live-Codex proof              | **Not required.** All four parts are pure — no spawn, no filesystem, no clock, no real provider.                                                                                  | —                                                                                     | Not applicable                                    |
| Typecheck                                    | Strict TypeScript 7, no `any`, no assertion, no `@ts-ignore`                                                                                                                      | `corepack pnpm typecheck`                                                             | Required                                          |
| Architecture / module-structure proof (RED7) | One export per behavior leaf; `.js` specifiers; barrel discipline; no forbidden edge; expected-file list and type pins updated for all three new domains                          | `corepack pnpm verify:architecture` and `corepack pnpm run test:unit`                 | Required                                          |
| Package / export proof                       | At this historical baseline, root export stayed exactly `export {}`; no new subpath; no deep import                                                                               | `corepack pnpm run test:package` and `corepack pnpm run verify:package`               | Required (must show no change)                    |
| Coverage                                     | v8 thresholds (80/90/90/90) on every new leaf                                                                                                                                     | `corepack pnpm run test:cov`                                                          | Required                                          |
| Format                                       | Oxfmt                                                                                                                                                                             | `corepack pnpm run format:check`                                                      | Required                                          |
| Lint                                         | Type-aware Oxlint, zero warnings, no unused suppressions                                                                                                                          | `corepack pnpm run lint`                                                              | Required                                          |
| Full gate                                    | Format → typecheck → lint → all owned test lanes → coverage → architecture → package                                                                                              | `corepack pnpm verify`                                                                | Required before handoff (`VERIFICATION.md:12-34`) |
| SonarCloud                                   | Blocking if `SONAR_TOKEN` available; missing token is skipped/blocked, never passed                                                                                               | `corepack pnpm run ci:local:sonar`                                                    | Conditional                                       |

---

## 8. Existing dirty-diff adoption plan

Every currently changed/new file in this worktree (`git status --short` re-verified immediately before this write;
unchanged throughout this analysis session), classified:

| File                                                                   | Classification          | Evidence                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/runtime/execution/child-environment/child-environment-request.ts` | **Retain unchanged**    | Matches the architect-ratified D1 layout and result contract exactly (`t_exec-adapter-02`); zero defects found in read (§1.5).                                                                                                                   |
| `src/runtime/execution/child-environment/child-environment-capture.ts` | **Retain unchanged**    | Same as above; 10-reason enum matches v1 §3.10 exactly.                                                                                                                                                                                          |
| `src/runtime/execution/child-environment/capture-child-environment.ts` | **Retain unchanged**    | Implements every rule in v1 §3.3 exactly; full `pnpm verify` gate green (§1.5); no gap found against the ratified contract.                                                                                                                      |
| `src/runtime/execution/child-environment/index.ts`                     | **Retain unchanged**    | Barrel matches the established convention this slice's new domains will copy.                                                                                                                                                                    |
| `src/runtime/execution/reflective-object-read.ts`                      | **Retain unchanged**    | Verified behavior-preserving extraction (input-snapshot's own 30-test suite still green, §1.5); becomes the shared helper parts 2–4 should reuse rather than re-implementing reflective reads.                                                   |
| `src/runtime/execution/index.ts` (barrel diff)                         | **Retain, then extend** | The five added lines are correct and green; parts 2–4 add three more analogous export blocks in the same file, following the same pattern — no correction needed to what already exists.                                                         |
| `src/runtime/execution/input-snapshot.ts` (diff)                       | **Retain unchanged**    | Pure refactor (extraction), behavior-preserving, 30 tests still pass including `input-snapshot.test.ts` itself; no gap found.                                                                                                                    |
| `test/types/runtime-module-structure.ts` (diff)                        | **Retain, then extend** | The 45 added lines for child-environment types are correct (`typecheck` green, §1.5); parts 2–4 add analogous `Expect<Equal<...>>` blocks for their own types in the same file.                                                                  |
| `test/unit/runtime/module-structure.test.ts` (diff)                    | **Retain, then extend** | The 5 added lines for the child-environment expected-file list are correct (`test:architecture` and the module-structure unit test both green, §1.5); parts 2–4 add the 11 new file paths (8 entities) for their three domains to the same list. |
| `test/unit/runtime/execution/child-environment.test.ts`                | **Retain unchanged**    | 14 cases, superset of v1's required acceptance criteria, all passing; no correction needed.                                                                                                                                                      |

**No file in the current dirty diff requires replacement or exclusion.** Every file is either retained unchanged or
retained-and-extended (the barrel and the two module-structure/type-surface registration files, which must
necessarily grow to register the three new domains — that growth is additive, not corrective).

**Required action before any new production code:** rebase this worktree's branch onto `origin/master` (`bba9882`),
which brings in `PreparedLaunch` and its six-file changeset (§1.3). Evidence in §1.3 shows the two changesets do not
intersect in edited line ranges even in the three files they share, so this is expected to be a **clean,
non-conflicting rebase** — not a "resolve conflicts under TDD" scenario in the sense the run-state warning
anticipated, though the developer must still re-run RED1 (`child-environment.test.ts`) and the full `pnpm verify`
gate immediately after the rebase to confirm this expectation before writing any new part-2–4 code, per the run-
state's own instruction not to assume a rebase-driven shift is safe without re-verification.

---

## 9. The provider-neutral real-process adapter remains the next separate slice

Explicitly, per the brief: after this slice ships, the next slice is the generic `ProcessSupervisionPort →
InvocationExecutionPorts['execution']` adapter, and — per §2's evidence — it will very likely first need its own
architect-owned design pass for a new `ExecutionPlan`/`PreparedExecution` handoff (argv assembly, protocol/
permission/parser strategy selection, and a resolution to `InvocationInputSnapshot`'s missing `prompt`/`parameters`
fields). This slice does not implement, wire, or anticipate that handoff's shape.

---

## 10. Decision register (resolved directly, with citations; no `NEEDS_INPUT` in this set)

These are ordinary technical-shape decisions this analyst role resolved directly, per this task's explicit
instruction to resolve ordinary ambiguity with cited evidence rather than converting it into a stop condition. None
reopens a boundary, ownership, public-contract, or data-model question beyond what D1 already settled.

### 10.1 No new combined numeric bound for sealed secret registration

**Question:** should part 2 enforce a new combined count/byte ceiling across `configuredSecrets` +
`invocationSecrets`? **Evidence:** `docs/specs/agent-manager-v1.spec.md:1082-1085` states bounds per _source_
(environment: 128 keys/256 KiB; configured redaction secrets: 1,000 values/64 KiB) and never states a third,
combined bound. **Decision:** part 2 performs structural defense-in-depth validation only (non-empty string check)
and does not invent a new numeric ceiling; each input already carries its own spec-mandated bound from its owning
boundary (part 1 for invocation secrets; existing manager-option validation for configured secrets). Inventing an
unrequested combined ceiling would be speculative scope beyond both the spec and the brief (`AGENTS.md`: "smallest
sufficient implementation... add abstractions only for an existing boundary, variation, or test seam").

### 10.2 Truncation signal is a queryable boolean, not an in-band literal marker

**Question:** should the bounded guard write a literal marker into the redacted byte stream itself? **Evidence:**
`docs/specs/agent-manager-v1.spec.md:1147` ("stdout and stderr end with one bounded truncation marker within their
file limit") describes the _future file writer's_ on-disk behavior (Stage 4, explicitly excluded here); every
existing repository convention for "truncated" (`raw-response-diagnostic.ts:3`, `normalize-invocation-outcome.ts:36`,
`probe-executable.ts:82-94`, `validation-diagnostics` module) is a boolean field, never bytes embedded in a content
stream. **Decision:** the guard exposes a queryable `truncated(): boolean` accessor and simply stops forwarding
bytes once `maxBytes` is reached; the actual on-disk literal marker (if any) is the Stage 4 file writer's
responsibility to append when it later observes `truncated() === true`. This keeps the guard's contract consistent
with the rest of the codebase and avoids smuggling a file-layer concern into a pure byte-processing module.

### 10.3 `dispose()` fails closed rather than no-ops after disposal

**Question:** should `feed()`/`flush()` after `dispose()` silently no-op or throw? **Evidence:** `AGENTS.md`: "Model
expected failures explicitly... Never swallow errors silently"; `REVIEW.md` blocking-findings list treats any path
that could let unredacted bytes reach a sink after disposal as exactly the kind of risk this substrate exists to
prevent. **Decision:** post-disposal calls throw a stable, documented error. A silent no-op could be miscoded by a
future caller as "successfully processed," creating exactly the silent-drop risk `AGENTS.md` forbids; a throw is the
fail-closed choice and is trivially testable (RED6).

### 10.4 No new port for parts 2–4

**Question:** does streaming redaction or the bounded guard need a new port abstraction, given they are cross-
cutting concerns? **Evidence:** extends D1's own reasoning (`t_exec-adapter-02`) verbatim: `docs/architecture.md:138`
already places "ports" ownership in `runtime/execution`; parts 2–4 are pure functions/decorators with exactly one
implementation and no current variation; part 4 already implements an _existing_ port shape (`ProcessOutputSink`)
rather than requiring a new one. **Decision:** no new port. Revisit only if a second implementation or an explicit
test-substitution seam is later needed, exactly as D1's own deferred-option-(b) trigger condition states.

### 10.5 Registration-before-guard ordering is not branded; corrected claim, deliberate residual risk

**Question:** §3.3 part 2 item 6 originally claimed the registration-before-guard ordering was "enforced by the type
system, not by convention." **Evidence:** `SealedSecretRegistration.secretValues` and the `secretValues` parameter
`createRedactionChannel`/`createRedactingBoundedOutputSink` accept are both a bare `readonly string[]` — an unbranded
structural type. Any array literal of strings satisfies that type identically to `registerSecrets()`'s real output;
nothing at the type level distinguishes them. The original claim was false as specified. **Decision:** correct the
claim rather than change the design — the ordering is enforced by **composition-root discipline** (every real call
site must thread `SealedSecretRegistration.secretValues` through, never a hand-built literal), not by the type
system, and this is stated as a named residual risk in §3.3 item 6 for whoever wires the real spawn/composition path
in the next slice. **Why not introduce a branded `SealedSecretValues` wrapper type instead (the alternative fix):**
this slice's four parts are pure, minimal, single-implementation modules by design (§3.5, §10.4); adding a nominal
wrapper type would touch part 2's result type, part 3's constructor parameter, and part 4's request type all at once,
for a slice whose brief is scoped to the pre-spawn security substrate itself, not to hardening its own call-site
API against a future composition-root author who has not been written yet (`references/quality/minimal-sufficient-
code.md`: add abstractions only for an existing boundary, variation, or test seam — no such call site exists yet in
this repository to test the branding against). Deferred, not rejected outright: if the next slice's composition-root
work reveals real call-site drift (an ad-hoc array literal actually reaching part 3/4 in production code), that slice
should revisit branding then, against a real call site instead of a hypothetical one.

**No `NEEDS_INPUT` condition found in this decision set.** The one genuinely open architecture question (§2, the
future `ExecutionPlan`/`PreparedExecution` handoff) is explicitly _not_ a blocker for this slice — it is evidenced,
not resolved, and named as the next architect task below, which is the correct escalation size per
`references/core.md` ("mark architecture uncertainty as `needs_architect` instead of resolving it inside analysis")
without stopping this slice's own readiness.

---

## 11. Handoff

### Artifact

- Absolute path: `/home/egor/work/dev/revo/revo-agent-runtime/.worktrees/analysis-execution-adapter-next-slice/docs/design/t_exec-adapter-01-execution-adapter-next-slice.md`
- SHA-256: computed after this write — see the final message of this task (`sha256sum` run immediately after save).

### Repository state

- Worktree: `/home/egor/work/dev/revo/revo-agent-runtime/.worktrees/analysis-execution-adapter-next-slice`
- Branch: `analysis/execution-adapter-next-slice`
- HEAD (worktree base): `48fe66170a81a2a577b81395e739f4618313206e`
- `origin/master` HEAD at analysis time: `bba988273c4b3cee79b7409be21b4622a1971273` (one commit ahead; not yet
  merged/rebased into this worktree — confirmed `git merge-base --is-ancestor bba9882 HEAD` → `no`)
- `git status --short`: four modified files, two new top-level docs, one new source directory, one new source file,
  one new test file — enumerated in full in §1.5 and classified in full in §8. Unchanged throughout this analysis
  session (re-verified immediately before this write).

### Commands run and observed output (this session, read-only)

| Command                                                                                                                                                                                                                                                        | Observation                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git fetch origin --quiet` then `git log --oneline origin/master -5`                                                                                                                                                                                           | confirmed `bba9882` is `origin/master` tip, one commit ahead of this worktree's `48fe661` base                                                                         |
| `git merge-base --is-ancestor bba9882 HEAD`                                                                                                                                                                                                                    | `no` — confirmed not yet merged into this worktree                                                                                                                     |
| `git diff 48fe661 bba9882 --stat` and targeted per-file diffs                                                                                                                                                                                                  | established §1.3's exact PR #41 changeset and the non-overlap finding in §8                                                                                            |
| `git show origin/master:src/runtime/execution/prepared-launch.ts` (and `execution-ports.ts`, `lifecycle.ts`, `lifecycle-manager.ts`)                                                                                                                           | full read establishing §1.4 and §2                                                                                                                                     |
| `corepack pnpm typecheck`, `format:check`, `lint`                                                                                                                                                                                                              | all pass, zero diagnostics (§1.5)                                                                                                                                      |
| `corepack pnpm exec vitest run` (targeted, then full `test:unit`/`test:contract`/`test:integration`/`test:package`)                                                                                                                                            | all pass (§1.5)                                                                                                                                                        |
| `corepack pnpm run test:cov`                                                                                                                                                                                                                                   | 556 tests pass; all four coverage thresholds exceeded (§1.5)                                                                                                           |
| `corepack pnpm run test:architecture`                                                                                                                                                                                                                          | "Architecture validation passed (positive graph and negative probes)."                                                                                                 |
| `corepack pnpm run verify:package`                                                                                                                                                                                                                             | pass — build, publint, ATTW, exact-tarball proof all green                                                                                                             |
| Full reads of `src/runtime/execution/child-environment/**`, `reflective-object-read.ts`, `prepared-launch.ts`, `execution-ports.ts`, `lifecycle.ts`, `lifecycle-manager.ts`, `process-start-request.ts`, `process-output-sink.ts`, `codex-argument-builder.ts` | evidence for §1, §2, §3                                                                                                                                                |
| Full/targeted reads of `docs/roadmap.md`, `docs/architecture.md:100-200,255-394`, `docs/specs/agent-manager-v1.spec.md:540-599,1075-1160`, `docs/testing.md:46-105,227-266`, `REVIEW.md`, `VERIFICATION.md`, `docs/adr/0011-*.md`                              | canonical contract evidence for §3, §4, §10                                                                                                                            |
| `grep -rn` for `maxStdoutBytes`, `maxStderrBytes`, `redactionValues`, `AGENT_MANAGER_LIMITS`, `truncat`, `PreparedLaunch`                                                                                                                                      | established the unused-vs-wired bound findings in §1.2/§10.2 and the merge-boundary findings in §1.3/§1.4                                                              |
| No build, lint-fix, format-fix, commit, push, or destructive git command was executed                                                                                                                                                                          | analysis-only role; every command above is read-only or produces output only under `dist`/`coverage` (both gitignored, both untouched from a `git status` perspective) |

### Evidence vs. assumptions

**Evidence (read or run directly at this session):** every `path:line` citation above; the full green
`pnpm verify` run on the current dirty diff (§1.5); the exact non-overlapping diff ranges between the dirty diff and
PR #41 (§1.3); `PreparedLaunch`'s exact three-field shape and its call sites (§1.4); `InvocationInputSnapshot`'s
missing `prompt`/`parameters` fields against the normative spec (§2.2); the roadmap's unchanged stage boundary and
"Owns" list (§1.1); the complete built-in redaction grammar and carry/overflow/flush rules (§3.3 part 3, quoted
verbatim from spec).

**Assumptions (stated, not proven):**

1. That the rebase in §8 will in fact be conflict-free. The evidence (non-overlapping line ranges) strongly supports
   this, but it is not proof until the developer actually performs the rebase and re-runs `pnpm verify`.
2. That no other uncommitted or in-flight change exists in this worktree beyond what `git status --short` reported
   at the time of each check in this session — re-verified twice during this analysis, unchanged both times, but
   another process could still touch the tree between this artifact's completion and the developer's start (the
   run-state warning already anticipated this).
3. That `docs/roadmap.md` is unchanged between the worktree base and `origin/master` — confirmed by an empty
   `git diff 48fe661 bba9882 -- docs/roadmap.md`, not by re-reading the entire file a second time end-to-end.

### Next architect task title

**"Design the provider-neutral execution-plan handoff for the real-process adapter: resolve whether
`InvocationInputSnapshot` needs new `prompt`/`parameters` fields, and define the shape of the `ExecutionPlan`/
`PreparedExecution` artifact that assembles resolved argv, protocol/permission/parser strategy selection, and cwd
from `PreparedLaunch` plus this slice's child-environment/secret-registration/redaction-guard outputs."**

### Scope statement

No implementation, production code, test, export, package metadata, README claim, canonical roadmap/ADR/spec/
architecture edit, commit, push, PR, publication, or external-service change was made by this analyst role. No
public API was added or altered at that historical baseline (`src/index.ts` stayed `export {};`, unverified change confirmed by the green
`verify:package` run in §1.5, not by a new edit). No provider-support, platform-support, or supported-cell claim was
made or implied. No canonical contract was changed; every canonical decision referenced above was cited, not
modified. Every command run this session was read-only (typecheck, lint, format-check, test lanes, coverage,
architecture/package verification, `git` inspection commands) or wrote only to gitignored `dist`/`coverage`
directories, which were not committed and do not appear in `git status`. The sibling `orchestrator` repository was
not inspected.

---

## 12. Architect gate — review and ratification (Gate 1)

- Role: architect (read-only; no implementation; no production/spec/ADR edit — this section only)
- Worktree/branch/HEAD: unchanged from §11 (`48fe66170a81a2a577b81395e739f4618313206e`), re-verified at review time
  (`git status --short` unchanged; `git merge-base --is-ancestor bba9882 HEAD` still `no`).
- Read before deciding: canonical `roles/architect/ROLE.md` + `references/core.md`, `architecture-plan.md` template,
  `references/architecture/README.md` (agent-playbook); this artifact in full; `t_exec-adapter-02` (D1); `docs/
architecture.md`; `docs/specs/internal-module-structure.spec.md`; `REVIEW.md`; `references/quality/adr-authoring.md`;
  `docs/adr/0002,0008,0011`; direct reads of `src/runtime/execution/{child-environment/**,reflective-object-read.ts,
input-snapshot.ts,execution-ports.ts,process-supervision-port/process-output-sink.ts,process-supervision-port/
process-start-request.ts,bounded-command-port/bounded-command-request.ts}`, `src/platform/process/{node-posix-
bounded-command-port.ts,node-posix-process-supervision-port.ts}`, `src/strategies/permissions/codex/codex-argument-
builder.ts`, `src/runtime/spec/manager-options/agent-manager-options.ts`, `src/runtime/definition/validate-
definition/validate-manager-options.ts`, `src/runtime/policy/limits/agent-runtime-limits.ts`, and `origin/master:
{prepared-launch.ts,execution-ports.ts}` at `bba9882`.

### 12.1 Module layout and boundaries — ratified, with the flagged boundary question resolved

The three-new-domain layout in §3.5 is **implementation-ready as written**: `secret-registration/`, `redaction/`, and
`redacting-output-guard/` correctly stay in `runtime/execution`, correctly introduce no new port (extending D1's own
reasoning consistently, §10.4), correctly take the existing `ProcessOutputSink` shape as part 4's only cross-cutting
dependency, and correctly add no edge toward `platform/`, `strategies/`, or `application/` — confirmed directly against
`docs/architecture.md:159-192`'s dependency-direction table (execution has no outbound edge to those layers) and
`internal-module-structure.spec.md` §3.6's general one-entity-per-leaf rule (which is not limited to the five layers it
names explicitly — the leading sentence "every production leaf outside `src/runtime/spec` MUST export exactly one
entity" already covers `runtime/execution`, consistent with every existing leaf there today: `prepared-launch.ts`,
`input-snapshot.ts`, `process-output-sink.ts`, one export each).

**The declared-but-unused-bound boundary question, resolved:** I read both existing platform-level byte bounds directly
and they are two different ports with no relationship to each other or to the new part-4 guard.

- `NodePosixBoundedCommandPort.start()` (`src/platform/process/node-posix-bounded-command-port.ts:74-77`) hardcodes
  `65_536`/`5_000` fallbacks for `BoundedCommandRequest.maxStdoutBytes/maxStderrBytes/timeoutMs`
  (`bounded-command-port/bounded-command-request.ts:1-9`) and buffers output itself via `Buffer.concat` inside the
  port. This port backs the executable-probe/version-check bounded-command path — a different runtime concern (probe
  output is not per-invocation subscriber/file/result data governed by the spec's redaction rule) — and this slice must
  not touch, wrap, or supersede it.
- `NodePosixProcessSupervisionPort.start()` (`node-posix-process-supervision-port.ts:213-246`), the port that will
  eventually back real invocation execution, does **not** bound bytes itself: it asserts an injected
  `stdout`/`stderr: ProcessOutputSink` (matching `ProcessStartRequest`, `process-start-request.ts:3-11`) and pumps raw
  child bytes straight into whatever sink it is given. This is exactly the gap part 4 exists to fill: the future
  real-execution-adapter slice constructs `createRedactingBoundedOutputSink(...)` and passes it as
  `ProcessStartRequest.stdout`/`.stderr`; `node-posix-process-supervision-port.ts` itself needs no change.
- The manager-level configured bound this gap is actually about — `AgentManagerLimits.maxStdoutBytes/maxStderrBytes`
  (`agent-manager-options.ts:6-7`), already validated and defaulted (`validate-manager-options.ts:77-83,439-440`) but
  with zero production consumer today — is the value a future composition root should thread into part 4's injected
  `maxBytes` parameter. That threading is explicitly **not** this slice's job; part 4 correctly takes `maxBytes` as a
  constructor parameter rather than reading policy directly (§3.3 part 4 item 3, §10.2), which is the right shape to
  keep the module pure and defer the wiring decision to the composition-root slice named in §9/§11.

**Verdict: ratify as written.** The new redacting sink is **independent** of both existing platform-level bounds — it
supersedes neither, wraps neither, and will later be _injected into_ the process-supervision port rather than
modifying it. No correction needed to §3.5's layout or §3.4's exclusion list.

**§3.7 file-count check:** confirmed against §3.5's own tree — 11 files, 8 entities (already corrected in §3.7 and
RED7, §4).

### 12.2 ADR question — no ADR candidate, decided fresh for this expanded scope

Re-examined independently of D1's part-1 answer, per `references/quality/adr-authoring.md`'s significance test and
`references/core.md`'s ADR-gate criteria (module/boundary, public contract, persistence, runtime/security posture,
framework direction).

- ADR-0002 already decided the environment/redaction **policy** at the architecture level: "No child inherits
  wholesale `process.env`; credential values enter only through invocation secrets and join streaming redaction before
  spawn" (`docs/adr/0002-agent-manager-consumer-boundary.md:37-38`). This slice implements that already-accepted policy;
  it does not create it.
- ADR-0008 explicitly and affirmatively delegates the **algorithm**: "Cancellation, deadlines, shutdown, output
  finalization, terminal arbitration, exact byte/file/completed retention, and redaction are normative specification
  concerns. Their algorithms and limits belong in the draft specification, not this ADR"
  (`docs/adr/0008-real-mechanics-supervision-boundary.md:46-47`). The brief's pointer to "ADR-0011's ... exact
  algorithm language" does not match ADR-0011's actual content (read in full: admission/concurrency, workspace/CWD
  authorization, advisory-cancellation/authoritative-cleanup, platform rollout — no redaction language anywhere in it);
  the language the brief is describing is ADR-0008's, not ADR-0011's, and it already resolves this question by naming
  the spec, not an ADR, as the redaction algorithm's home.
- The normative algorithm and bounds this slice implements verbatim are already Accepted spec text
  (`docs/specs/agent-manager-v1.spec.md:1082-1145`), not proposed by this slice — confirmed by direct reading in this
  session (§ above, matches the analyst's citations exactly, including the `KEY`/`HEADER`/`BEARER`/`PEM` grammar, the
  64 KiB carry bound, and the discard-until-delimiter/final-flush rules).
- Parts 2–4 introduce no new port, no new public contract, no persistence change, and no change to an already-Accepted
  ADR's boundary. The one boundary-shaped sub-decision here — "no new port for parts 2–4" (§10.4) — is a decision
  _not_ to add an abstraction, trivially reversible per its own stated trigger condition, which is not the kind of
  hard-to-reverse commitment the ADR gate exists for.

**Verdict: no ADR candidate.** `adr_candidate.needed: false`. If this judgment is later found wrong (e.g., a future
slice's `ExecutionPlan`/strategy-selection work reveals redaction needs to become provider-aware), that would be a new
question for that slice, not a retroactive reopening of this one.

### 12.3 `ExecutionPlan`/`PreparedExecution` — confirmed, correctly excluded from this slice

Verified directly, not just accepted on the analyst's say-so:

- `origin/master:bba9882`'s `PreparedLaunch` (`src/runtime/execution/prepared-launch.ts`, read in full at that ref) is
  exactly `{ pin: { agentId, agentVersion, definitionDigest }, executable, reportedVersion }` — launch identity
  evidence, no argv/environment/cwd/strategy content. `execution-ports.ts` at that ref confirms `start(snapshot,
preparedLaunch)`.
- `ProcessStartRequest` (this worktree, `process-supervision-port/process-start-request.ts:3-11`) requires `cwd`,
  `args: readonly string[]`, `environment`, and per-channel `ProcessOutputSink`s — none of which `PreparedLaunch` or
  the current `InvocationInputSnapshot` (six fields: `agent, invocationId, metadata, resultSchema,
wallClockTimeoutMs, workspace` — read directly, unchanged at `bba9882`) carries.
- `CodexArgumentRequest` (`src/strategies/permissions/codex/codex-argument-builder.ts:3-10`, read in full) requires a
  `prompt: string` and optional `model`/`outputSchema`. `InvocationInputSnapshot.create()`'s `readRequest()` allowlist
  (`input-snapshot.ts:360-369`, read directly) accepts only six named keys and would reject an input object carrying
  `prompt` or `parameters` today.

This directly confirms §2's conclusion: the next real-execution-adapter slice will need a new, separate,
architect-owned design pass for an `ExecutionPlan`/`PreparedExecution` handoff, and will likely also need to reopen
`InvocationInputSnapshot`'s field set — both boundary/contract questions this analysis role correctly did not resolve
and correctly did not fold into this slice. **Confirmed, not merely accepted.** No part of this slice should
anticipate that shape (§3.4, §9 already state this correctly; no correction needed).

### 12.4 Rebase risk — spot-checked directly, claim confirmed

Ran the same comparisons myself rather than trusting §1.3/§8's assertion:

- `git diff 48fe661 bba9882 --stat` reproduces exactly the six-file/test-file changeset in §1.3.
- For all three shared files, I diffed both changesets against the same base and compared insertion points directly:
  - `src/runtime/execution/index.ts`: PR #41 inserts one line after the `NormalizedInvocationOutcome` export, before
    `RawResponseDiagnostic`; the dirty diff inserts a five-line block after `bounded-command-port`, before
    `execution-terminal-observation` — disjoint regions of the same file.
  - `test/types/runtime-module-structure.ts`: PR #41 touches the import list (adds `PreparedLaunch`) and the
    `ExpectedInvocationExecutionPorts.execution.start` signature; the dirty diff touches a different point in the
    same import list (adds three child-environment names) and inserts new type blocks and `Expect<Equal<...>>`
    exports elsewhere — no shared line, but note both changes touch the _same import statement_: a real rebase will
    merge two insertions into one `import type { ... }` block without textual conflict (git treats adjacent-line
    insertions into a multi-line import list as a clean three-way merge), which is consistent with, not a refutation
    of, the "clean rebase" classification, but worth the developer's attention as the one file where both diffs are
    genuinely adjacent rather than merely in different sections.
  - `test/unit/runtime/module-structure.test.ts`: PR #41 adds one line (`execution/prepared-launch.ts`) in alphabetical
    position after `normalized-invocation-outcome.ts`; the dirty diff adds four `child-environment/` lines before
    `execution-ports.ts` and one `reflective-object-read.ts` line after `raw-response-diagnostic.ts` — both
    alphabetically ordered, non-overlapping insertion points.

**Verdict: confirmed.** §8's "clean, non-conflicting rebase" classification holds under direct verification. The one
refinement: `test/types/runtime-module-structure.ts`'s shared import statement means the rebase will produce a
three-way merge of import lines rather than zero touched lines in that file — still conflict-free, but the developer
should expect `git rebase` to show that file as modified-by-both (cleanly auto-merged), not untouched-by-one-side, and
should re-run `pnpm typecheck` immediately after rebase to confirm the merged import block is well-formed (this is
already covered by §8's existing instruction to re-run `pnpm verify` post-rebase; no new step is required).

### 12.5 Sign-off summary

| Part                           | Verdict                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1 — child-environment capture  | Already architect-approved (D1); unchanged; retained.                                           |
| 2 — sealed secret registration | Ratified as written; layout and contract are implementation-ready.                              |
| 3 — streaming redaction        | Ratified as written; implements already-Accepted spec algorithm verbatim.                       |
| 4 — bounded redacting guard    | Ratified as written; confirmed independent of both existing platform-level byte bounds (§12.1). |

§3.7's file count (11 files, 8 entities) confirmed against §3.5's tree (§12.1). No other correction to file layout,
result contracts, module boundaries, or exclusions is required.

### 12.6 `needs_human`

**False.** No architecture/ADR approval, material risk acceptance, external permission, secret access, or destructive
action applies to this gate's own output. The pipeline's existing human gate — the user's approval of this whole
artifact (parts 2–4 scope plus this architecture ratification) before developer implementation begins — is the
`needs_human` this run already anticipates per the stated pipeline (`analyst spec → architect → reviewer Gate 1 → user
approval → developer implementation → Gate 2 review`); nothing beyond that already-scheduled approval is newly
required by this architecture review.

### 12.7 Scope statement

No production code, test, export, package metadata, canonical roadmap/ADR/spec edit, commit, push, or PR was made by
this architect role. Only this section (§12) was added to this artifact; §§1–11 are preserved verbatim as the
analyst's evidence and recommendation. `docs/architecture.md`, `docs/specs/internal-module-structure.spec.md`,
`REVIEW.md`, and every ADR referenced above were read, not modified.

ARCHITECTURE_GATE_COMPLETE

---

ANALYSIS_COMPLETE
