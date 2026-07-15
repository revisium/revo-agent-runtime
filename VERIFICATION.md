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

The command must pass without warnings. It includes:

1. Oxfmt formatting verification.
2. Strict TypeScript 7 typechecking.
3. Type-aware Oxlint with compiler diagnostics and unused-suppression detection.
4. Unit and contract tests currently present in the repository.
5. LCOV coverage generation.
6. ESM JavaScript and declaration build.
7. `publint` package metadata and export validation.
8. `@arethetypeswrong/cli` validation under the intentional ESM-only profile.
9. npm package-content dry-run validation.

## Required commands

| Capability | Command                        | Expected evidence                                                                |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Format     | `corepack pnpm format:check`   | No changed or incorrectly formatted files                                        |
| Typecheck  | `corepack pnpm typecheck`      | No TypeScript diagnostics                                                        |
| Lint       | `corepack pnpm lint`           | No warnings, errors, or unused suppressions                                      |
| Tests      | `corepack pnpm test`           | All tests pass                                                                   |
| Coverage   | `corepack pnpm test:cov`       | Tests pass and `coverage/lcov.info` is generated                                 |
| Build      | `corepack pnpm build`          | ESM JavaScript, source maps, declarations, and declaration maps in `dist/`       |
| Package    | `corepack pnpm verify:package` | `publint`, ESM type resolution, exports, declarations, and package contents pass |

## Conditional gates

Run these when their surface changes:

- GitHub workflows: `actionlint`.
- Shell scripts: `bash -n scripts/*.sh`.
- Package artifact or release workflow: `corepack pnpm pack --pack-destination <temporary-directory>` and inspect the listed contents.
- Dependency changes: `corepack pnpm audit --prod`; inspect lockfile changes and install-script policy.
- Public API changes: add runtime behavior tests where applicable, type-surface tests, package export checks, and README examples.
- Architecture-boundary changes: verify `REPOSITORY.md`, `docs/architecture.md`, the accepted ADRs, package imports, README examples, and implementation remain consistent.
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
