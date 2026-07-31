# Linux POSIX Cancellation, Deadlines, and Shutdown Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Implement and prove the private Linux/local-ext4 lifecycle path in which caller cancellation, deadlines, shutdown, natural exit, and authorized recovery all converge on bounded POSIX process-group cleanup without expanding package ownership or claiming an unshipped public API.

**Architecture:** Keep lifecycle arbitration provider-neutral in `src/runtime/execution/`, orchestration and consumer-facing process-local state in `src/application/manager/`, and signal/reap mechanics in the existing `src/platform/process/` adapter. A graceful provider-cancel hook is advisory and fire-and-forget; the retained private live-process capability is authoritative. No public export or provider-specific wire is added by this plan.

**Tech Stack:** Node.js 24, strict TypeScript 7/ESM, Vitest 4, pnpm 11, Linux `/proc`, POSIX process groups, local ext4 fixture execution.

---

## Verdict

**ARCHITECTURE_COMPLETE**

The user-approved decisions close the implementation architecture for the private runtime slice. Provider version, wire format, and provider-native conformance remain deliberately unresolved and are not needed to implement the provider-neutral optional dispatch seam or authoritative local cleanup. This verdict approves the architecture artifact only; **it does not authorize implementation, commits, pushes, package exports, publishing, or external mutations**. A separate implementation approval is required.

## Target versus shipped baseline

| Area                  | Accepted target                                                                                                                                       | Shipped source at plan time                                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission/concurrency | No manager active-admission cap or internal queue; consumer owns admission, concurrency, scheduling, and overload                                     | Existing manager prevents duplicate invocation IDs and has a bounded probe mechanism, but source/exports do not prove the complete target manager contract                      |
| Completed retention   | FIFO by completion; min 1, default/max 1,000; consumer may lower                                                                                      | `AGENT_MANAGER_LIMITS` and `CompletedInvocations` already encode these values/FIFO privately; root runtime export remains empty                                                 |
| Listeners             | Synchronous delivery; no package-owned numeric registration cap, queue, worker pool, fanout, or backpressure policy; listener failure isolated        | `TerminalSubscriptions.deliver()` is synchronous and isolates/removes throwing listeners, but registration is currently capped by `maxCompletedInvocations`, contrary to target |
| Workspace             | Bounded, normalized, absolute, existing consumer-authorized directory; invalid before output claim/spawn                                              | `InvocationInputSnapshot` has no workspace field and `ProcessStartRequest` has no working directory; target is not shipped                                                      |
| Provider cancellation | Optional generic graceful-cancel dispatch, best-effort and not drained/awaited; absent/unsupported/throwing follows identical immediate local cleanup | Existing `requestCancellation()` is an awaited execution-port operation; no source/export proves target provider behavior                                                       |
| Active-state save     | Start `cancelling` save best-effort; never await its timeout or quiescence before local cleanup                                                       | Existing private lifecycle has no active-state persistence port; target is not shipped                                                                                          |
| POSIX cleanup         | Group `SIGTERM`, wait at most 2,000 ms, group `SIGKILL` only if still live, then confirm group absence and leader reap                                | `NodePosixProcessSupervisionPort` currently has a 250 ms grace constant and private `terminateAndReap()`; source does not prove the complete target across all lifecycle causes |
| Terminal races        | First terminal candidate authoritative; no duplicate signal/finalization                                                                              | Existing `InvocationLifecycle.beginFinalization()` guards first transition, but all new cancellation/shutdown/process cleanup races still require conformance proof             |
| Platform evidence     | Linux on local ext4 first; macOS requires later native evidence; Windows outside MVP                                                                  | Existing integration tests are Linux-conditional candidate-host tests and do not certify ext4 or a support matrix                                                               |
| Public/package status | No public API/export in this implementation slice                                                                                                     | Root package export is intentionally empty; target documents are drafts and not shipped behavior                                                                                |

## Accepted invariants

1. The manager has no package-owned active-admission capacity and no internal invocation queue. Duplicate-ID exclusion is identity safety, not concurrency policy. Probe admission bounds remain a separate safeguard; lifecycle listener registration has no package-owned numeric capacity.
2. Completed outcomes alone consume `maxCompletedInvocations`; FIFO completion order is deterministic; active/finalizing invocations are not evicted. The accepted range is exactly 1..1,000 with default 1,000.
3. Lifecycle listeners run synchronously on delivery. Registration is not coupled to `maxCompletedInvocations` or any other package-owned numeric limit. The consumer owns subscription count, disposal, fanout, and backpressure policy; the package adds no asynchronous queue, worker, fanout, batching, fairness, latency, or downstream backpressure guarantee. Listener exceptions cannot change invocation outcome.
4. `workspace.directory` is consumer-authorized input. The package checks bounded text, lexical normalization, absoluteness, existence, and directory kind before output claim and spawn. It does not certify realpath, symlinks, containment, ownership, provenance, stable ancestry, or hostile-rebinding safety.
5. Provider graceful cancellation is optional, generic, advisory, best-effort, and non-blocking. Dispatch is attempted only for caller cancellation, deadline cancellation, or shutdown cancellation when the selected definition advertises cancellation. Unsupported, unavailable, and synchronously/asynchronously failed dispatch all proceed immediately to the same local cleanup path. Natural exit and recovery do not dispatch it.
6. The consumer-backed `cancelling` save starts best-effort and is not awaited before signalling. Save failure/timeout/late completion cannot suppress, delay, or revoke local signal authority.
7. Only a retained live capability from this manager or a fresh exact recovery fingerprint match authorizes signalling. Persisted PID/PGID/invocation/pin/time values are correlation only.
8. Every authorized cleanup sends group `SIGTERM`; waits no more than 2,000 ms; sends group `SIGKILL` only if the group is still live; and succeeds only after confirmed group absence and leader close/reap. The same mechanics cover cancellation, deadline, shutdown, natural leader exit with descendants, and authorized recovery.
9. Cleanup failure is failed-closed/nonterminal as required by the owning lifecycle context. It never synthesizes successful completion or successful shutdown, and cleanup authority remains available for retry where the accepted contract requires it.
10. The first terminal candidate remains authoritative. Concurrent caller/deadline/shutdown/natural-exit observations do not signal, finalize, publish, notify, or settle twice.
11. Linux/local-ext4 evidence proves only that cell. It does not imply macOS, Windows, overlay, tmpfs, container-host, network filesystem, or provider conformance.

## Boundary and non-goals

- Do not add manager scheduling, active capacity, admission queues, workflow retries, durable orchestration, leases, claims, host policy, or consumer database types.
- Do not add a package-owned numeric listener registration cap, listener queue, worker pool, downstream fanout, batching, or backpressure policy.
- Do not infer or enforce workspace/output containment and do not add realpath, symlink, ownership, provenance, or hostile-rebinding certification.
- Do not weaken ADR-0010 output stable-ancestor warranties or expand cleanup to consumer-owned output evidence.
- Do not add provider-specific cancellation payloads, transports, versions, SDK types, acknowledgement/drain behavior, or conformance claims.
- Do not expose child processes, PIDs/PGIDs, signals, descriptors, or provider types publicly.
- Do not add or change root exports, package metadata, README claims, accepted ADRs, or target specifications in this slice.
- Do not claim macOS support from Linux evidence. Do not implement Windows; reject unsupported platforms before output claim/spawn when that public preflight is implemented.
- Do not commit, push, publish, or mutate external services as part of this architecture artifact.

## Implementation sequence

Every numbered slice below is one **2–5 minute focused TDD action**. Do not start it without separate implementation approval. Keep each RED failure attributable to the named missing behavior; if it fails for an unrelated reason, stop and diagnose rather than proceeding.

### Slice 1 — Lock ownership bounds and remove listener-capacity coupling

**Files:** Test `test/unit/application/manager/completed-invocations.test.ts`, `test/unit/application/manager/subscriptions.test.ts`, and `test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts`; modify only `src/application/manager/completed-invocations.ts`, `src/application/manager/subscriptions.ts`, `src/runtime/policy/limits/agent-manager-limits.ts`, or `src/application/manager/lifecycle-manager.ts` if the new characterization exposes a mismatch.

- **RED:** Add focused cases proving 1/default/max 1,000 completed FIFO, active IDs not consuming FIFO capacity, synchronous listener execution, listener registrations continuing beyond a deliberately low `maxCompletedInvocations`, and multiple distinct active invocations admitted without an active-cap/queue decision. Run:
  `corepack pnpm exec vitest run test/unit/application/manager/completed-invocations.test.ts test/unit/application/manager/subscriptions.test.ts test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts`
  Expected RED: current listener registration rejects at the completed-retention capacity; active-admission assertions may fail only for an independently demonstrated target mismatch. Do not reinterpret probe bounds as invocation or listener capacity.
- **Minimal GREEN:** Preserve completed FIFO limits, probe bounds, synchronous snapshot delivery, throwing-listener isolation/removal, and disposable subscriptions. Remove listener registration capacity and its coupling to `maxCompletedInvocations`; remove the capacity-rejection branch/types that become unreachable. Remove or avoid a package-owned active admission cap/queue only if a test independently demonstrates one. Do not replace the removed listener cap with another numeric limit or add scheduling/fanout/backpressure abstractions.
- **Verify:** Re-run the exact RED command; expected PASS.

### Slice 2 — Admit the consumer-authorized workspace before side effects

**Files:** Modify `src/runtime/execution/input-snapshot.ts`, `src/runtime/execution/execution-ports.ts`, and `src/application/manager/lifecycle-manager.ts`; test `test/unit/runtime/execution/input-snapshot.test.ts`, `test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts`; update fake behavior in `test/support/lifecycle-conformance/create-lifecycle-conformance-subject.ts` and `test/support/execution/fake-execution-port.ts`.

- **RED:** Add cases for bounded normalized absolute existing directory acceptance and relative, absent, non-directory, oversized, or normalization-invalid rejection. Assert rejection occurs before `output.prepare()` and `execution.start()`. Run:
  `corepack pnpm exec vitest run test/unit/runtime/execution/input-snapshot.test.ts test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts -t "workspace|invalid preflight"`
  Expected RED: workspace is currently not admitted or preflighted.
- **Minimal GREEN:** Snapshot a copied/frozen workspace directory; expose the smallest provider-neutral execution preflight operation needed to ask whether that normalized absolute path exists and is a directory; invoke it before output prepare. Keep filesystem mechanics behind the port and return the existing private rejection shape until a separately authorized public typed error surface exists.
- **Verify:** Re-run the exact RED command; expected PASS with zero output/execution-start calls for invalid workspaces.

### Slice 3 — Carry the approved workspace to process spawn

**Files:** Modify `src/runtime/execution/process-supervision-port/process-start-request.ts`, `src/platform/process/node-posix-process-supervision-port.ts`, and `test/support/process/fake-process-supervision-port.ts`; test `test/unit/platform/node-posix-process-supervision-port.test.ts` and `test/integration/platform/node-posix-process-supervision.test.ts`.

- **RED:** Add a unit assertion that spawn receives the normalized workspace as `cwd`, plus a real-process assertion that the fixture observes that working directory. Run:
  `corepack pnpm exec vitest run test/unit/platform/node-posix-process-supervision-port.test.ts -t "working directory|workspace"`
  Expected RED: `ProcessStartRequest` currently has no directory and spawn cannot prove `cwd`.
- **Minimal GREEN:** Add the immutable directory field to the private start request, copy it in the fake, and pass it directly as Node spawn `cwd`; do not perform realpath/containment/ownership/provenance checks here.
- **Verify:** Re-run the unit command, then:
  `corepack pnpm exec vitest run test/integration/platform/node-posix-process-supervision.test.ts -t "working directory|workspace"`
  Expected PASS on Linux; this is mechanics evidence, not yet ext4-cell evidence.

### Slice 4 — Make graceful provider cancellation advisory

**Files:** Modify `src/runtime/execution/execution-ports.ts` and `src/runtime/execution/lifecycle.ts`; test `test/unit/runtime/execution/lifecycle.test.ts`; update `test/support/execution/fake-execution-port.ts`.

- **RED:** Add table-driven tests for supported dispatch, unavailable hook, synchronous throw, asynchronously rejected dispatch, and never-settling dispatch. In every case assert local `requestCancellation()` starts in the same microtask turn and no provider acknowledgement/drain is awaited. Run:
  `corepack pnpm exec vitest run test/unit/runtime/execution/lifecycle.test.ts -t "graceful|advisory|provider"`
  Expected RED: current lifecycle awaits the single cancellation request path and cannot distinguish advisory dispatch from authoritative cleanup.
- **Minimal GREEN:** Split the private execution contract into optional fire-and-forget graceful dispatch and required local cleanup request. Gate dispatch by the snapshotted cancellation capability; attach a rejection observer only to prevent unhandled rejection, and proceed immediately. Do not define provider wire/version/types.
- **Verify:** Re-run the exact RED command; expected PASS, including the never-settling hook case.

### Slice 5 — Start `cancelling` persistence without delaying cleanup

**Files:** Modify `src/runtime/execution/execution-ports.ts` and `src/runtime/execution/lifecycle.ts`; test `test/unit/runtime/execution/lifecycle.test.ts`; update `test/support/execution/fake-execution-port.ts`.

- **RED:** Add ordered-call tests for successful, throwing, rejected, and never-settling `cancelling` saves. Assert save invocation begins before local cleanup dispatch but cleanup is not delayed and no late save changes terminal arbitration. Run:
  `corepack pnpm exec vitest run test/unit/runtime/execution/lifecycle.test.ts -t "cancelling active state|non-blocking save"`
  Expected RED: no active-state save seam exists.
- **Minimal GREEN:** Add the smallest consumer-backed best-effort save operation and rejection observer; invoke it without awaiting it, then immediately enter authoritative local cleanup. Retain bounded diagnostic ownership in the existing private outcome/evidence path; do not invent durable schema or provider behavior.
- **Verify:** Re-run the exact RED command; expected PASS for the never-settling save.

### Slice 6 — Enforce the 2,000 ms process-group escalation contract

**Files:** Modify `src/platform/process/node-posix-process-supervision-port.ts`; test `test/unit/platform/node-posix-process-supervision-port.test.ts`.

- **RED:** Replace/extend timer-controlled tests to prove: group `SIGTERM` is first; no `SIGKILL` before 2,000 ms; early `ESRCH` suppresses `SIGKILL`; exactly one group `SIGKILL` follows if still live at the bound; success waits for both group absence and leader close/reap; repeated `terminateAndReap()` shares one settlement. Run:
  `corepack pnpm exec vitest run test/unit/platform/node-posix-process-supervision-port.test.ts -t "SIGTERM|SIGKILL|2,000|reap|idempotent"`
  Expected RED: current source uses a 250 ms grace and lacks at least the exact 2,000 ms proof.
- **Minimal GREEN:** Change the private grace to 2,000 ms and keep one memoized cleanup settlement. Poll liveness without extending the bound; signal negative PGID only; treat `ESRCH` as absence; require group absence and child close/reap before resolving. Propagate non-`ESRCH` signal/check/reap failures.
- **Verify:** Re-run the exact RED command; expected PASS with fake timers and exact signal order.

### Slice 7 — Sweep descendants after natural leader exit

**Files:** Modify `src/platform/process/node-posix-process-supervision-port.ts` and `src/runtime/execution/process-supervision-port/live-owned-process.ts`; test `test/unit/platform/node-posix-process-supervision-port.test.ts`, `test/integration/platform/node-posix-process-supervision.test.ts`; modify fixture `test/fixtures/process/reference-child.sh`.

- **RED:** Extend the fixture to leave a same-group descendant alive after leader exit. Add a unit race test and a real-process test proving `completion` remains pending until the shared cleanup confirms group absence and leader reap, with no provider dispatch. Run:
  `corepack pnpm exec vitest run test/unit/platform/node-posix-process-supervision-port.test.ts -t "natural.*descendant|descendant.*natural"`
  Expected RED: current completion can follow leader close without proving descendant sweep.
- **Minimal GREEN:** Route natural close through the same idempotent group-absence/reap settlement used by explicit termination. Preserve the first raw terminal observation separately from cleanup completion; do not infer descendants from persisted PGID.
- **Verify:** Re-run the unit command, then:
  `corepack pnpm exec vitest run test/integration/platform/node-posix-process-supervision.test.ts -t "natural.*descendant|descendant.*natural"`
  Expected PASS on Linux with the fixture group absent afterward.

### Slice 8 — Preserve first-terminal arbitration across caller/deadline/natural races

**Files:** Modify `src/runtime/execution/lifecycle.ts`; test `test/unit/runtime/execution/lifecycle.test.ts`, `test/contract/lifecycle-conformance/settlement-result-event-retention-conformance.test.ts`; update `test/support/execution/fake-execution-port.ts`.

- **RED:** Add deterministic permutations: natural-before-caller, caller-before-natural, deadline-before-caller, caller-before-deadline, and cleanup failure after each candidate. Assert one local cleanup, one terminal result attempt, one completed entry, one notification, and the first candidate's normalized status. Run:
  `corepack pnpm exec vitest run test/unit/runtime/execution/lifecycle.test.ts test/contract/lifecycle-conformance/settlement-result-event-retention-conformance.test.ts -t "first terminal|race|exactly once"`
  Expected RED: new split provider/local cancellation and cleanup confirmation are not yet arbitrated together.
- **Minimal GREEN:** Add one private terminal-candidate latch before side effects; make every source submit to it; let process cleanup confirmation gate finalization without changing the selected cause. Reuse existing finalization guard and cancellation promise rather than adding parallel state machines.
- **Verify:** Re-run the exact RED command; expected PASS with exactly-once assertions.

### Slice 9 — Converge manager shutdown on the same cancellation path

**Files:** Modify `src/application/manager/agent-manager.ts`, `src/application/manager/lifecycle-manager.ts`, and `src/runtime/execution/lifecycle.ts`; test `test/contract/manager/lifecycle.test.ts` and `test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts`; update `test/support/lifecycle-conformance/create-lifecycle-conformance-subject.ts`.

- **RED:** Add cases proving shutdown atomically rejects new starts, requests each accepted invocation once through ordinary cancellation, includes private/starting work in its drain, shares one settlement across concurrent shutdown callers, clears listeners only after successful drain, and rejects/remaining-failed-closed when cleanup cannot be confirmed. Run:
  `corepack pnpm exec vitest run test/contract/manager/lifecycle.test.ts test/contract/lifecycle-conformance/admission-lifecycle-conformance.test.ts -t "shutdown"`
  Expected RED: current shipped manager source does not prove the target shutdown contract.
- **Minimal GREEN:** Add one manager shutdown latch/promise and snapshot active/private work under the existing manager ownership boundary. Reuse lifecycle cancellation with cause `shutdown`; do not create a shutdown-specific provider/process path or internal work queue.
- **Verify:** Re-run the exact RED command; expected PASS including concurrent callers and failed-closed cleanup.

### Slice 10 — Apply identical cleanup to exact-match recovery only

**Files:** Modify `src/application/manager/agent-manager.ts`, `src/application/manager/lifecycle-manager.ts`, `src/runtime/execution/execution-ports.ts`, and `src/runtime/execution/process-supervision-port/process-supervision-port.ts`; test `test/contract/manager/lifecycle.test.ts`, `test/unit/runtime/execution/process-supervision-port.test.ts`; update `test/support/process/fake-process-supervision-port.ts`.

- **RED:** Add tests that persisted PID/PGID alone never signal; missing/mismatched/ambiguous fresh fingerprint yields no signal and context-specific failed-closed reconciliation; exact fresh fingerprint permits the same 2,000 ms terminate/kill/absence/reap operation; provider graceful cancellation is never called for recovery. Run:
  `corepack pnpm exec vitest run test/unit/runtime/execution/process-supervision-port.test.ts test/contract/manager/lifecycle.test.ts -t "recovery|fingerprint|signal authority"`
  Expected RED: no complete recovery cleanup path exists in shipped source.
- **Minimal GREEN:** Extend the private supervision port only enough to acquire an authorized recovery cleanup capability after exact fresh inspection. Feed that capability into the same cleanup settlement; never signal from persisted identifiers directly.
- **Verify:** Re-run the exact RED command; expected PASS and zero signal calls in every non-exact case.

### Slice 11 — Prove the Linux/local-ext4 cell with real fixture mechanics

**Files:** Modify `test/fixtures/process/reference-child.sh` and `test/integration/platform/node-posix-process-supervision.test.ts`; production fixes, if evidence exposes a defect, remain limited to `src/platform/process/node-posix-process-supervision-port.ts`.

- **RED/environment precondition:** Run from repository root:
  `test "$(uname -s)" = Linux && test "$(findmnt -n -o FSTYPE -T "$PWD")" = ext4 && printf 'kernel=%s fs=%s\n' "$(uname -r)" "$(findmnt -n -o FSTYPE -T "$PWD")"`
  Expected: exit 0 and `fs=ext4`. If not, mark this slice **BLOCKED/UNAVAILABLE**; do not call it passed and do not generalize candidate-host results.
- **RED:** Add real fixture modes for cooperative SIGTERM, ignored SIGTERM requiring SIGKILL, natural leader exit with a live group descendant, and post-cleanup group absence/leader reap. Run:
  `corepack pnpm exec vitest run test/integration/platform/node-posix-process-supervision.test.ts --reporter=verbose`
  Expected RED before mechanics are complete; tests must enforce Linux and ext4 evidence explicitly rather than silently treating another filesystem as the target cell.
- **Minimal GREEN:** Make only defects exposed by the real mechanics conform to the shared cleanup contract; do not add sleeps as correctness, broaden platform claims, or add provider behavior.
- **Verify:** Re-run the precondition command and integration command. Record kernel, filesystem, exact test names, elapsed termination timing, signal path exercised, confirmed group absence, and leader reap. Evidence is valid only for this Linux/local-ext4 run.

### Slice 12 — Internal/package regression and declaration proof

**Files:** Modify internal barrels only if required: `src/runtime/execution/index.ts`, `src/application/manager/index.ts`, and `src/platform/process/index.ts`; validate existing package surface in `test/package/source-entrypoints.test.ts` and architecture rules in `test/unit/runtime/module-structure.test.ts`.

- **RED:** Add/adjust assertions that private contracts are reachable only through approved internal barrels and root package exports remain empty. Run:
  `corepack pnpm exec vitest run test/unit/runtime/module-structure.test.ts test/package/source-entrypoints.test.ts`
  Expected RED only if an internal type is not exported through its owning barrel or leaked publicly.
- **Minimal GREEN:** Update only owning internal barrels. Do not add a root export or deep-import path.
- **Verify:** Re-run the exact RED command, then `corepack pnpm build`; expected PASS with declarations and no public runtime export claim.

## Mandatory verification gates

Run targeted commands after each slice as specified. Before handoff, all locally applicable gates are mandatory and must be reported with exact status; a narrow pass is not a full pass.

1. `corepack pnpm format:check`
2. `corepack pnpm typecheck`
3. `corepack pnpm lint`
4. `corepack pnpm test:unit`
5. `corepack pnpm test:contract`
6. `corepack pnpm test:integration` — valid Linux/local-ext4 target evidence only when the `findmnt` precondition above passes
7. `corepack pnpm test:package`
8. `corepack pnpm test:cov`
9. `corepack pnpm verify:architecture`
10. `corepack pnpm build`
11. `corepack pnpm verify:package`
12. **Aggregate required gate:** `corepack pnpm verify`

`corepack pnpm format` is mutating and may be run only during an authorized implementation stage, followed by `corepack pnpm format:check`; it is not authorized by this plan. Missing ext4, provider access, credentials, or remote gates are `BLOCKED`, `UNAVAILABLE`, or `SKIPPED`, never passed.

## Evidence acceptance checklist

- [ ] Every behavior change began with a focused failing test and recorded the expected reason.
- [ ] Invalid workspace was rejected before output claim and spawn; accepted workspace became process `cwd` without extra certification claims.
- [ ] Supported, unsupported, failed, and hung provider dispatch all reached local cleanup immediately; natural exit/recovery emitted no provider dispatch.
- [ ] `cancelling` save was invoked best-effort and a hung save did not delay first local signal.
- [ ] SIGTERM/SIGKILL timing and order were verified with fake timers; SIGKILL happened only for a still-live group.
- [ ] Real Linux/ext4 fixture evidence confirmed cooperative termination, forced termination, natural descendant sweep, group absence, and leader reap.
- [ ] Caller/deadline/shutdown/natural races retained one authoritative terminal candidate and exactly-once finalization.
- [ ] Recovery signalled only after exact fresh fingerprint match and reused identical cleanup mechanics.
- [ ] Completed FIFO and synchronous listener contracts remained intact; listener registration accepted more subscriptions than a deliberately low completed-retention limit, and no package-owned numeric listener cap, active cap/queue, or listener fanout/backpressure policy was introduced.
- [ ] Root exports remained empty; docs targets were not represented as shipped.
- [ ] All mandatory gates, especially `corepack pnpm verify`, passed or were accurately marked blocked/unavailable.

## Risks and mitigations

- **Timer versus OS observation races:** group disappearance may occur between liveness check and signal. Treat `ESRCH` as absence, propagate other errors, memoize cleanup, and prove order with fake timers plus real processes.
- **PID/PGID reuse:** persisted correlation is never authority. Recovery must use a fresh exact fingerprint before acquiring signal capability.
- **Natural leader close before descendant exit:** do not resolve completion from leader close alone; gate terminal finalization on group absence and leader reap.
- **Hung consumer/provider operations:** attach rejection observers but never await advisory provider dispatch or `cancelling` save before cleanup. Ensure no unhandled rejection and no late terminal mutation.
- **Synchronous listener reentrancy:** preserve snapshot delivery/disposal behavior and terminal latch before notifications; do not introduce asynchronous ordering guarantees.
- **Unbounded package registration count:** removing the arbitrary numeric cap means a consumer that registers listeners without disposing them can retain memory. Keep disposal explicit and synchronous delivery isolated, but leave subscription count, fanout, and backpressure ownership with the consumer rather than introducing a package policy that cannot guarantee memory or latency safety.
- **Workspace TOCTOU/rebinding:** accepted policy is lexical/existence/directory validation under consumer authorization, not hostile-path safety. State that limitation; do not silently add inadequate certification.
- **Flaky real-time integration checks:** use fake timers for exact 2,000 ms logic; real fixture tests prove mechanics with bounded tolerance and postcondition polling, not equality to wall-clock milliseconds.
- **Coverage/quality-gate pressure:** prefer small private seams in existing ownership layers; no broad casts, suppressions, test-only production branches, or duplicate state machines.
- **Support-claim overreach:** retain explicit Linux/ext4 precondition and evidence record; a Linux test on tmpfs/overlay is not target-cell evidence.

## Unresolved items and stop conditions

The following are intentionally unresolved and **must not be decided by implementation**:

1. Provider versions, provider-specific graceful-cancel wire/protocol, SDK behavior, acknowledgement semantics, and native provider conformance.
2. macOS implementation details and native filesystem evidence cell.
3. Any Windows process/filesystem architecture or support path beyond outside-MVP rejection.
4. Any public API/export, stable error codes beyond already accepted contracts, compatibility commitment, or package support declaration.
5. Hostile workspace-rebinding defenses, realpath/symlink policy, ownership/provenance, and workspace/output containment.
6. Consumer scheduling, concurrency limits, overload policy, consumer-side listener fanout/backpressure implementation, durable history, and workflow recovery decisions. The absence of a package-owned numeric listener registration cap is accepted and is not reopened by this item.

Stop and return `BLOCKED` for a new architecture decision if implementation would require any item above, would signal from persisted identity without exact fresh observation, would await provider/save completion before local cleanup, would weaken confirmed group-absence/leader-reap success, would add non-existing provider wire assumptions, or would change public exports/docs. Lack of a Linux local-ext4 execution host blocks only the native evidence gate and support claim; it does not authorize substituting another filesystem.
