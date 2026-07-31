# POSIX Cancellation Path-Trust Analysis

Status: `needs_architect`
Scope: filesystem path trust and consumer-owned output-ancestor rules for provider-neutral cancellation, deadlines, and shutdown
Baseline: `origin/master` / `c0c64139986305b9d7072be19bbc9fe5f0a7843c`
Worktree: `/home/egor/work/dev/revo/revo-agent-runtime/.worktrees/posix-cancellation-deadlines-shutdown`

## Compact decision frame

**Context:** The package is invocation-scoped. The consumer constructs workspace/output paths; the package owns bounded local POSIX process reconciliation and conflict-safe recording inside one exact consumer-supplied output directory.

**Problem:** The accepted target contract requires normalized absolute workspace/output paths and an atomic non-existing output-leaf claim, but expressly defers trust/provenance policy for consumer-owned ancestors (realpath, symlink, mounts, and network filesystems). Cancellation and shutdown must not delete consumer evidence, while finalization must publish `result.json` exclusively and clean only manager-owned scratch/temp paths.

**Question:** What trust statement, if any, must the consumer make about output ancestors, and what package-side mechanism is required to preserve that statement against symlink substitution and TOCTOU?

**Options:**

1. Consumer-certified ancestors; package enforces only the already-specified absolute-path and exact-leaf rules.
2. Package preflight walks and rejects symlink/non-directory ancestors, then performs the existing path-based claim.
3. Architect a descriptor-relative POSIX trust anchor and perform claim/finalization/cleanup relative to held directory capabilities.

**Recommendation:** Do not silently select options 2 or 3 in implementation. Preserve the exact-leaf contract and route the ancestor trust/provenance policy to an architect/user decision. Option 1 is the only bounded option that does not add a package responsibility beyond the current accepted ownership boundary, but it leaves ancestor substitution and path-based TOCTOU as an explicit consumer/environment residual risk. This is a boundary recommendation, not a claim that option 1 is secure for hostile shared ancestors.

## 1. Confirmed requirements

| Requirement                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The consumer owns path construction, durable indexing/recovery, and retention; the package owns conflict-safe recording in one supplied directory.                                                                                 | `REPOSITORY.md:23-40`, `REPOSITORY.md:42-55`; `docs/adr/0003-invocation-output-recording.md:14-21`; `docs/architecture.md:139-143`                                                                                              |
| The output directory is mandatory and opaque; its leaf must not exist. Missing parents are created, then the final leaf is created atomically and non-recursively.                                                                 | `docs/specs/agent-manager-v1.spec.md:516-519`; `docs/adr/0003-invocation-output-recording.md:19-21`; `REPOSITORY.md:97-102`                                                                                                     |
| Any existing final leaf, including an empty directory or symlink, is `revo.agent.output_conflict`; no adoption, overwrite, rotation, suffixing, or deletion is allowed. Concurrent claimants have one winner.                      | `docs/specs/agent-manager-v1.spec.md:516-524`; `docs/adr/0003-invocation-output-recording.md:19-21`; `REVIEW.md:54-57`                                                                                                          |
| Workspace and output paths must be normalized absolute paths. Containment is not required and hierarchy must not be inferred.                                                                                                      | `docs/specs/agent-manager-v1.spec.md:526-529`; `REPOSITORY.md:42-51`                                                                                                                                                            |
| Trust, existence/type, symlink, realpath, mount, network-filesystem, and provenance rules beyond the final-leaf claim are explicitly deferred. Absolute does not imply trusted.                                                    | `docs/specs/agent-manager-v1.spec.md:526-529`, `docs/specs/agent-manager-v1.spec.md:1236-1248`; `docs/adr/0008-real-mechanics-supervision-boundary.md:46-49`                                                                    |
| Output claim and private `starting` registration form one synchronous, non-re-entrant pre-acceptance transition so shutdown cannot miss a claimed leaf.                                                                            | `docs/architecture.md:272-280`; `REVIEW.md:56-57`; `docs/testing.md:133-139`                                                                                                                                                    |
| A rejected pre-acceptance start publishes no result or terminal event. Its claimed leaf remains consumer-owned quarantined evidence; only manager scratch/temp paths may be cleaned, and retry must use a fresh path.              | `docs/specs/agent-manager-v1.spec.md:520-524`; `docs/testing.md:255-259`; `docs/adr/0009-process-signal-authority.md:32-37`                                                                                                     |
| Reserved output names are `.scratch`, `events.ndjson`, `stdout.log`, `stderr.log`, failure-only `raw-final-response.txt`, and `result.json`.                                                                                       | `REPOSITORY.md:97-105`; `docs/specs/agent-manager-v1.spec.md:1137-1148`; `docs/adr/0003-invocation-output-recording.md:27-34`                                                                                                   |
| `.scratch` is owner-only, rejects symlink conflicts, and is cleaned only after process reap; cleanup failure is typed, while crash residue belongs to consumer recovery/retention.                                                 | `docs/specs/agent-manager-v1.spec.md:154-159`; `docs/specs/agent-manager-v1.spec.md:1158-1169`; `docs/adr/0003-invocation-output-recording.md:23-25`                                                                            |
| `result.json` publication is exclusive, same-directory, non-replacing: exclusive temp, write/flush, hard link to absent result path, directory flush where supported, temp unlink. Unsupported semantics or collision fail closed. | `docs/adr/0003-invocation-output-recording.md:36-39`; `docs/specs/agent-manager-v1.spec.md:1150-1156`; `REVIEW.md:47-55`                                                                                                        |
| Late recording failure must not strand process-local completion. A failed result commit leaves `result.json` absent, does not recurse, and still commits/exposes one in-memory terminal result.                                    | `docs/adr/0003-invocation-output-recording.md:41-50`; `docs/specs/agent-manager-v1.spec.md:1170-1183`; `REPOSITORY.md:107-109`                                                                                                  |
| Process/group cleanup precedes active-row removal and file finalization. Unconfirmed descendant cleanup blocks terminal completion and preserves active state; shutdown then fails closed if cleanup cannot be confirmed.          | `docs/specs/agent-manager-v1.spec.md:1158-1169`; `docs/adr/0006-consumer-backed-active-invocation-recovery.md:43-48`, `docs/adr/0006-consumer-backed-active-invocation-recovery.md:69-77`; `REVIEW.md:26-29`, `REVIEW.md:39-46` |
| Persisted PID/PGID/invocation correlation never authorizes signaling. Authority is a private live capability or a fresh exact package-owned fingerprint match.                                                                     | `docs/adr/0009-process-signal-authority.md:16-30`; `docs/adr/0006-consumer-backed-active-invocation-recovery.md:50-67`                                                                                                          |
| The package must not delete consumer output directories during shutdown.                                                                                                                                                           | `REVIEW.md:39-41`; `AGENTS.md:54-56`                                                                                                                                                                                            |

## 2. Configured, intentionally disabled/deferred, and runtime-verified facts

### Configured

- `test:integration` is a real script and is included in aggregate `test`: `package.json:40-46`.
- CI/release currently run `pnpm verify` on `ubuntu-latest`, without a platform/filesystem matrix: `.github/workflows/ci.yml:17-20`, `.github/workflows/ci.yml:41-44`; `.github/workflows/release.yml:9-12`, `.github/workflows/release.yml:31-34`.
- Vitest includes all `test/**/*.test.ts`, including integration tests: `vitest.config.ts:4-12`.

### Intentionally disabled or deferred

- The root runtime API is intentionally empty: `src/index.ts:1`; `REPOSITORY.md:19-21`, `REPOSITORY.md:88-95`.
- Real process/filesystem/security/cancellation/shutdown and the public AgentManager remain incomplete as a package-level claim. The current integration lane is candidate-host evidence only: `docs/testing.md:57-64`.
- Ancestor filesystem trust/provenance and supported platform/filesystem cells are explicitly deferred: `docs/specs/agent-manager-v1.spec.md:1236-1248`; `docs/adr/0008-real-mechanics-supervision-boundary.md:46-49`.
- Source has only a logical output port (`prepare`, terminal-result recording, event recording), not a real filesystem output implementation: `src/runtime/execution/execution-ports.ts:5-20`. A scoped source/test search found no production `result.json`, `.scratch`, leaf-claim, realpath, or symlink implementation. Therefore the filesystem target is documented, not shipped.

### Runtime-verified in this stage

- Command actually run: `corepack pnpm test:integration -- --run test/integration/platform/node-posix-process-supervision.test.ts`.
- Observed result: one file passed, four tests passed. Those tests are Linux-gated and cover a populated reference file, canonical OS fingerprint, private-live-capability group kill/reap, and cleanup after an invariant-check failure: `test/integration/platform/node-posix-process-supervision.test.ts:79-98`, `:100-133`, `:135-159`, `test/integration/platform/node-posix-process-supervision.test.ts:161-188`.
- This proves only the exercised candidate-host process-supervision slice. It does **not** prove output path trust, filesystem publication, provider conformance, full verify, coverage, macOS, Windows, mounts, network filesystems, or CI.
- The command unexpectedly materialized the repository's ignored dependency tree because dependencies were absent. No explicit install command was run, but pnpm performed dependency installation before the test. This is reported as an execution issue rather than hidden. Tracked status remained clean before artifact creation.

## 3. Consumer/package ownership boundary

### Consumer-owned

- Construction and provenance of workspace/output paths and all run/step/attempt hierarchy.
- Trust decision for consumer-owned ancestors under the currently accepted/deferred contract.
- Durable output/result indexing, retention, crash-residue removal, retry path allocation, and public workflow projections.
- Escalation/replacement policy when process cleanup or shutdown cannot be confirmed.

Evidence: `REPOSITORY.md:42-55`; `docs/adr/0003-invocation-output-recording.md:14-25`; `docs/adr/0008-real-mechanics-supervision-boundary.md:30-39`.

### Package-owned

- Validation that supplied workspace/output strings meet the agreed path contract (currently normalized absolute and bounded).
- Atomic, non-adopting claim of exactly the final output leaf.
- All reserved children and bounded/redacted writes inside the claimed leaf.
- Owner-only `.scratch`, exclusive `result.json`, and cleanup of manager-created scratch/temp paths only.
- Process kill/reap confirmation and lifecycle/file-finalization ordering.

Evidence: `REPOSITORY.md:23-40`, `REPOSITORY.md:97-109`; `docs/specs/agent-manager-v1.spec.md:516-529`, `:1137-1183`.

### Boundary invariant

A claimed leaf becomes consumer-owned evidence even if setup is later rejected. Package ownership of reserved files and temporary mechanics does not grant authority to remove the invocation leaf or any ancestor.

## 4. Threat cases and current contract coverage

| Threat case                                  | Current rule / gap                                                                                                                                                                                                               | Consequence                                                                                                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relative output/workspace path               | Rejected: both must be normalized absolute (`agent-manager-v1.spec.md:526-529`).                                                                                                                                                 | Prevents current-working-directory ambiguity, but says nothing about ancestor trust.                                                                                                                                                      |
| Absolute path through untrusted ancestors    | Explicitly not trusted merely because absolute; ancestor policy deferred (`agent-manager-v1.spec.md:526-529`, `:1245-1248`).                                                                                                     | Consumer/environment may redirect resolution before or during package operations unless a stronger contract is selected.                                                                                                                  |
| Consumer-owned ancestor does not exist       | Current target says manager creates missing parents (`agent-manager-v1.spec.md:516-518`).                                                                                                                                        | This mutates consumer hierarchy. Ownership, modes, allowable creation depth, and race behavior require clarification under any hostile-ancestor model.                                                                                    |
| Existing ancestor is a symlink               | Only a symlink at the final leaf is explicitly conflict (`agent-manager-v1.spec.md:516-519`); ancestor symlink policy is deferred.                                                                                               | Path may resolve outside the consumer's intended tree.                                                                                                                                                                                    |
| Final leaf exists or is symlink              | Atomic non-recursive creation must fail `output_conflict`; no adoption (`agent-manager-v1.spec.md:516-524`).                                                                                                                     | Covered if the creation primitive is applied to the intended parent.                                                                                                                                                                      |
| TOCTOU between validation and leaf creation  | No ancestor anti-substitution mechanism is specified; filesystem trust policy is deferred.                                                                                                                                       | A preflight `lstat`/`realpath` alone would not bind later path-based operations to the inspected directory.                                                                                                                               |
| TOCTOU after leaf claim                      | Reserved-child operations are specified by path, but no held-directory-capability requirement is stated.                                                                                                                         | If consumer-owned ancestors can be renamed/replaced, later `.scratch`, log, result, and cleanup operations may target a different object unless implementation is capability-relative or the environment contract excludes that attacker. |
| `result.json` pre-exists/races               | Exclusive temp + hard-link publication to absent result path; `EEXIST` fails closed and no replacing rename (`agent-manager-v1.spec.md:1150-1156`).                                                                              | Protects committed evidence inside the actual claimed directory; does not independently establish ancestor identity.                                                                                                                      |
| `.scratch` replaced by symlink               | Symbolic-link conflicts must be rejected and access owner-only (`agent-manager-v1.spec.md:154-159`).                                                                                                                             | Requirement exists; implementation/evidence does not yet. Ancestor/leaf identity still matters.                                                                                                                                           |
| Cleanup after cancellation/deadline/shutdown | Reap descendants first; remove only manager-owned `.scratch`/temp; never output leaf/ancestors; cleanup uncertainty blocks or types completion as specified (`agent-manager-v1.spec.md:1158-1177`; `REVIEW.md:39-44`, `:61-62`). | Cleanup must be object-safe as well as name-safe; a path-rebinding attacker could otherwise turn a permitted child cleanup into deletion elsewhere.                                                                                       |
| Crash residue                                | Manager does not scan/adopt; consumer retention may remove whole invocation directory (`agent-manager-v1.spec.md:154-159`; `ADR-0003:23-25`).                                                                                    | Consumer must use its own provenance/trust rules before recursive deletion.                                                                                                                                                               |
| Network or non-hard-link filesystem          | Supported cells and mount/network-filesystem policy deferred; missing required hard-link behavior fails `output_write_failed` (`agent-manager-v1.spec.md:1150-1156`, `:1245-1248`).                                              | Cannot claim support without an approved cell and real harness evidence.                                                                                                                                                                  |

## 5. Bounded options and consequences

### Option 1 — Consumer-certified ancestors, existing package contract only

Contract addition outside or at the consumer boundary: the consumer warrants that workspace/output ancestors are trusted and stable for the invocation lifetime. Package validates bounded normalized absolute paths, creates missing parents under that warranty, atomically creates the final leaf, and keeps all current non-deletion/publication rules.

Consequences:

- Fits the accepted ownership allocation: consumer constructs paths and the package treats them as opaque.
- Requires no new package trust-anchor API.
- Does not defend against a malicious peer able to rewrite ancestors; this must be an explicit unsupported threat model, not implied safety.
- Consumer recursive residue cleanup remains independently security-sensitive.

### Option 2 — Package path-walk preflight without held capabilities

Package `lstat`s each existing ancestor, rejects symlinks/non-directories, creates allowed missing parents, and rechecks before final-leaf claim.

Consequences:

- Detects static misconfiguration and common symlink accidents.
- Crosses the currently deferred trust-policy boundary and needs an approved definition of trusted roots, ownership/mode checks, mount behavior, and errors.
- Does not close TOCTOU when subsequent mkdir/write/link/unlink operations resolve path strings again.
- Risks creating a misleading “secure path” claim unsupported by the current docs or harness.

### Option 3 — Descriptor-relative POSIX trust anchor

Consumer and package agree on an explicit trusted existing ancestor; package opens/holds a directory capability and performs descendant inspection, creation, publication, and cleanup relative to held capabilities with no-follow/exclusive semantics where the selected platform exposes them.

Consequences:

- Can make ancestor identity stable across subsequent operations and directly address name-rebinding/TOCTOU.
- Requires an architected public/internal contract, platform adapter design, exact Node/native capability assessment, supported filesystem matrix, error mapping, and real hostile-race tests.
- May change the consumer/package boundary by requiring a trust root or capability rather than only an opaque path.
- Must remain provider-neutral but will be platform/filesystem-specific below the port.

## 6. Evidence-based recommendation

1. **Route stop: `needs_architect`.** Accepted sources deliberately defer exactly the disputed ancestor policy, and ADR-0008 says it requires separate approved evidence before implementation (`docs/adr/0008-real-mechanics-supervision-boundary.md:46-49`; `docs/specs/agent-manager-v1.spec.md:1245-1248`). An analyst cannot select the new policy.
2. Preserve the already accepted invariants regardless of the selected option: normalized absolute paths; opaque consumer hierarchy; atomic non-existing final leaf; no adoption/replacement/deletion; claimed rejected leaf remains consumer evidence; process reap before scratch cleanup/finalization; exclusive non-replacing `result.json`.
3. If the user intentionally excludes hostile ancestor mutation from the v1 threat model, Option 1 is the only bounded option consistent with current ownership without a new architecture decision. Record the residual risk and do not describe it as symlink/TOCTOU protection.
4. If hostile consumer-owned ancestors are in scope, do not use Option 2 as the terminal security design. Request architectural investigation of Option 3 and platform feasibility, then require real filesystem race tests before any support claim.

## 7. Decisions required from the user/architect

1. Is an attacker able to create, rename, replace, or symlink any output ancestor during invocation/finalization, or are ancestors consumer-certified stable?
2. May the package create missing consumer-owned parents, or must the consumer provide one existing trusted parent and leave the package only the final-leaf claim?
3. Are symlinks in any output ancestor forbidden, allowed after canonicalization, or allowed only under an explicit trusted root?
4. Must output remain beneath a configured trust root, or is any consumer-supplied normalized absolute path valid?
5. Is path-string API compatibility mandatory, or may the target contract introduce a trust-root/directory-capability concept?
6. Which platform/filesystem cells are intended for v1 (Linux local filesystems only, Darwin, specific mounts/network filesystems), and what fail-closed behavior applies elsewhere?
7. Who verifies safe recursive deletion of rejected/crash-residue leaves on the consumer side?

## 8. Acceptance criteria after the decision

- The normative spec states the threat model and ancestor trust/provenance rule without implying that absolute means trusted.
- Contract tests cover relative and non-normalized rejection, final-leaf `EEXIST` for directory/file/symlink, and concurrent one-winner claim.
- Real filesystem tests cover every selected ancestor rule, symlink substitution, race windows relevant to the chosen mechanism, and unsupported filesystem failure.
- `result.json` tests prove non-replacement, same-directory exclusive publication, missing-result behavior after failure, and temp cleanup diagnostics.
- Cancellation/deadline/shutdown tests prove process-group reap before filesystem cleanup and that only manager-owned scratch/temp objects are removed.
- Rejected pre-acceptance setup leaves the claimed leaf as consumer evidence and retries require a fresh path.
- Support claims are limited to actually exercised platform/filesystem cells; candidate-host evidence is not generalized.
- Targeted commands and observed results are reported separately from full `pnpm verify`; no unexecuted gate is called passed.
