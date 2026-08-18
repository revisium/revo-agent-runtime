<!-- RECONSTRUCTION NOTE, not a verbatim recovery. -->
<!-- The original architect artifact at coverage/kanban/t_exec-adapter-02-child-environment-capture-architecture.md -->
<!-- was destroyed by vitest's coverage-v8 `clean: true` reportsDirectory wipe (same incident as t_exec-adapter-01). -->
<!-- Only the architect's own end-of-task summary (not the full artifact body) survived, in the orchestrator's -->
<!-- conversation transcript. This file reconstructs that summary; it is NOT the original document's full reasoning, -->
<!-- citations, or prose — treat it as a lossy pointer, not a source of truth. If full fidelity is needed, re-dispatch -->
<!-- the architect role with the same brief (D1 is settled, so it should reproduce materially the same decision). -->

# t_exec-adapter-02 — Child-environment capture: architecture decision (RECONSTRUCTED SUMMARY)

- Role: architect (read-only; no implementation)
- Worktree: `/home/egor/work/dev/revo/revo-agent-runtime/.worktrees/analysis-execution-adapter-next-slice`
- Branch: `analysis/execution-adapter-next-slice`
- Base / HEAD: `48fe66170a81a2a577b81395e739f4618313206e`
- Read before deciding: canonical architect `ROLE.md` + `references/core.md`, `architecture-plan.md` template,
  `references/architecture/README.md` (all from `agent-playbook`), the analyst artifact (`t_exec-adapter-01`),
  `docs/architecture.md`, `docs/specs/internal-module-structure.spec.md`, ADR-0008/0009/0011/0012, `adr-authoring.md`,
  `escalation.md`.

## D1 decision (the only question this role was asked to resolve)

**Explicit child-environment capture is a pure function owned by `runtime/execution`** (analyst's option (a)) — no new
`HostEnvironmentPort`. Reasoning: `docs/architecture.md:159-192` already establishes `platform -> runtime/execution` as
a permitted dependency edge, so the not-yet-built `platform/process/environment.ts` can call the pure
`captureChildEnvironment` function directly with no new port needed. The apparent tension at `docs/architecture.md:142`
resolves once "explicit environment" (platform's future mechanical role: reading real `process.env`) is read separately
from "credential policy" (the decision itself, correctly excluded from `platform` and placed in `runtime/execution`).

## Module layout (ratified, matches what developer actually built)

```text
src/runtime/execution/child-environment/
├── child-environment-request.ts
├── child-environment-capture.ts
├── capture-child-environment.ts
└── index.ts
```

Matches the existing `*-port/`-style domain-folder convention already used elsewhere in `runtime/execution`.

## Result contract (ratified analyst's sketch with concrete field names)

- `ChildEnvironmentRequest` — the untrusted `{ inherit, variables, secrets }` shape.
- `ChildEnvironmentCapture` — discriminated union:
  - `{ status: 'captured', environment, secretValues }`
  - `{ status: 'rejected', reason: <flat reason enum> }`

## ADR candidate

**None produced.** The decision applies an already-accepted dependency edge (`docs/architecture.md:159-192`), touches no
public contract, persistence, or security posture, and does not reopen ADR-0008/0009/0011/0012. A one-sentence
documentation clarification (disambiguating "explicit environment" mechanics from "credential policy" ownership at
`docs/architecture.md:142`) was drafted inside the original artifact as a **proposal only** — it was never applied to
`docs/architecture.md` itself. That proposal text itself is part of what was lost with the original file; if it matters,
re-derive it by re-reading `docs/architecture.md:118-119,138,142` with this same D1 resolution in mind.

## Developer handoff (as executed)

- Exact files as in the module layout above.
- Ratified first RED test: unchanged from analyst §3.7 ("captures only the named host variables and nothing else from
  the host snapshot").
- Five additional constraints given to the developer: no imports from `platform`/`strategies`/`application` into this
  new domain; one-entity-per-leaf; `.js` specifiers everywhere; no `export *`; defensive host-snapshot reads (mirroring
  `input-snapshot.ts`'s existing hostile-input discipline).
- Required verification gates: same list as analyst §5 (unit, typecheck, architecture, package, coverage, full
  `pnpm verify`; contract/integration/live-Codex proofs explicitly not applicable to this pure-function slice).

## Alternatives considered and rejected

- **Option (b): new `HostEnvironmentPort` + `platform/process` adapter.** Deferred, not rejected outright — explicit
  trigger condition given for revisiting it later: _when a second host-environment source appears, or when a test seam
  requiring dependency substitution is actually needed_ (today there is exactly one implementation and no such seam,
  so `AGENTS.md`'s "add abstractions only for an existing boundary, variation, or test seam" argues against adding it
  now).
- **Option (c): place the whole decision in `platform/process`.** Rejected outright as directly contradicting
  `docs/architecture.md`'s module-ownership table (platform must not own credential policy).

## `needs_human`

**False**, stated explicitly — no ADR/architecture approval, material risk acceptance, or other escalation gate
(per `../../method/escalation.md`) applies to this technical-shape-only decision.

## Scope statement

No production code, tests, exports, or canonical docs (`docs/architecture.md`, any ADR, any spec) were modified by the
architect role itself; the doc-clarification text was a proposal embedded in the (now-lost) artifact, not an applied
edit.
