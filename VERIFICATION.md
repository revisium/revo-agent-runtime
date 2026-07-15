# Verification Contract

This file is the executable repository-local verification contract. Exact repository scripts take precedence over generic tool commands. Missing credentials or provider access must be reported as skipped or blocked, never as passed.

## Environment

- Node.js: `>=24.11.1 <25`, with `.nvmrc` as the local baseline.
- Package manager: pnpm 11.13.0 through Corepack.
- Install command: `corepack pnpm install --frozen-lockfile`.
- Local secrets belong in ignored environment files. Start from `.env.sonar.example`; never commit tokens.

## Primary local gate

Run before handoff, commit, or pull-request publication:

```bash
corepack pnpm verify
```

The command must exit zero without unexpected warnings. `@arethetypeswrong/cli` intentionally reports its ignored CJS-to-ESM
profile diagnostic while accepting the ESM-only package. The gate includes:

1. Oxfmt formatting verification.
2. Strict TypeScript 7 typechecking.
3. Type-aware Oxlint with compiler diagnostics and unused-suppression detection.
4. Every currently owned Vitest lane; bootstrap owns only the package lane.
5. Vitest v8 coverage with `coverage/lcov.info` and configured thresholds.
6. Architecture lint over the positive graph plus temporary layer-import, consumer-private-import, and cycle probes.
7. ESM JavaScript and declaration build.
8. `publint` package metadata and export validation.
9. One package orchestrator creates one exact tarball with an isolated temporary npm cache.
10. `@arethetypeswrong/cli`, package-content validation, and isolated ESM/TypeScript/deep-import consumer proof all use that
    exact tarball.

## Required commands

| Capability   | Command                             | Expected evidence                                                          |
| ------------ | ----------------------------------- | -------------------------------------------------------------------------- |
| Format       | `corepack pnpm format:check`        | No changed or incorrectly formatted files                                  |
| Typecheck    | `corepack pnpm typecheck`           | No TypeScript diagnostics                                                  |
| Lint         | `corepack pnpm lint`                | No warnings, errors, or unused suppressions                                |
| Tests        | `corepack pnpm test`                | Every currently owned Vitest lane passes                                   |
| Package test | `corepack pnpm test:package`        | Empty bootstrap root and package metadata tests pass                       |
| Architecture | `corepack pnpm verify:architecture` | Positive graph and all three representative negative probes pass           |
| Coverage     | `corepack pnpm test:cov`            | Tests and v8 thresholds pass; `coverage/lcov.info` is generated            |
| Build        | `corepack pnpm build`               | ESM JavaScript, source maps, declarations, and declaration maps in `dist/` |
| Package      | `corepack pnpm verify:package`      | Source metadata plus one-tarball ATTW/content/ESM/types/deep-import proof  |

Do not add empty `test:unit`, `test:contract`, or `test:integration` scripts. Add each lane with its first owned behavior.

## Conditional gates

Run these when their surface changes:

- GitHub workflows: `actionlint`.
- Shell scripts: `bash -n scripts/*.sh`.
- Package artifact or release workflow: `corepack pnpm verify:package`; use a temporary directory for any additional manual
  tarball inspection.
- Dependency changes: `corepack pnpm audit --prod`; inspect lockfile changes and install-script policy.
- Public API changes: add runtime behavior tests where applicable, type-surface tests, package export checks, and README examples.
- Architecture-boundary or `.oxlintrc.architecture.json` changes: run `corepack pnpm verify:architecture` and confirm the
  committed harness still proves layer, consumer-private-import, and cycle violations fail non-zero.
- Target API documentation changes: reconcile ADRs, `docs/specs/agent-manager-v1.spec.md`, `docs/architecture.md`, README,
  repository/review contracts, and testing policy. Do not claim draft exports exist.
- Documentation or configuration changes: rerun `corepack pnpm format:check` and check links and commands against current scripts.

Do not commit artifacts created only for verification. Use a temporary directory for tarballs.

## SonarCloud

Sonar is configured through `sonar-project.properties`, repository scripts, and `.github/workflows/ci.yml`.

For the full local parity run:

```bash
corepack pnpm ci:local:sonar
```

Provide `SONAR_TOKEN` through `.env.sonar`, `SONAR_ENV_FILE`, or the environment. The command reruns the primary gate, uploads analysis, waits for the Quality Gate, and inspects open issues for the current PR or branch.

Sonar policy:

- Quality Gate failure is blocking.
- Every new valid open issue is blocking even when an aggregate status appears green.
- A false positive or accepted risk requires concrete evidence and the narrowest approved disposition.
- Missing token, Browse permission, project access, PR decoration, or issue-level access is a provider gate failure or skipped gate, not a pass.

## Remote gates

After push, verify the same head commit:

- GitHub Actions `CI / verify` completed successfully.
- Sonar PR Quality Gate and open-issue inspection ran when `SONAR_TOKEN` was available.
- Required review conversations have zero unresolved valid findings.
- Manual release validation produces an artifact without publishing it.

Do not merge, publish npm packages, create releases, or modify protected branches without the corresponding explicit approval.

## Evidence rules

- Report exact commands and whether each run covered the full gate or a targeted subset.
- Distinguish passed, failed, pending, skipped, unavailable, and not applicable.
- A successful narrow test does not prove the aggregate gate passed.
- Claims about pre-existing failures require evidence from the base branch or an earlier recorded run.
- If this file disagrees with `package.json` or CI, report the mismatch and correct the contract in the same scoped change when authorized.
