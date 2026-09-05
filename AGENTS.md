# Revo Agent Runtime

This repository implements the current public contract in
[docs/API.md](./docs/API.md). Public symbols are changed only by an approved
task, and the package exposes only its root entrypoint.

Before editing, read `REPOSITORY.md`, `VERIFICATION.md`, `REVIEW.md`, the
relevant current API or architecture document, and `package.json`.

- Work on a feature branch and validate locally before opening a pull request.
  CI runs the frozen install, full verification, and configured Sonar checks on
  pushes and pull requests. Do not publish or mutate authentication state; run
  a live provider only when the approved task or route selects its smoke gate,
  using the existing launch context and never performing login or credential
  changes.
- Start behavior work with a readable failing test, make the smallest green
  change, then follow the authoritative iteration delivery sequence in
  `VERIFICATION.md` before `corepack pnpm verify`.
- Keep source bounded and provider-neutral. Runtime source cannot import tests,
  scripts, generated output, or concrete protocol dependencies outside their
  owning adapter boundary.
- Preserve the approved root API and do not scaffold future module directories
  before their first behavior slice.
- Leave implementation changes uncommitted after local gates and review. The
  integrator commits, pushes, and opens the pull request; remote CI and Sonar
  must pass on that pushed commit before merge.
