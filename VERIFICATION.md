# Verification contract

Use Node `>=24.15.0 <25` (recommended: `24.18.0` from `.nvmrc`) and pnpm
11.13.0 through Corepack. Install with:

```bash
corepack pnpm install --frozen-lockfile
```

The authoritative local gate is:

```bash
corepack pnpm verify
```

## Delivery sequence

Behavior changes follow one required sequence: RED behavior test, minimal GREEN
production change, production readability refactor, test/fixture readability
refactor, architecture/package/full gate, then the applicable smoke or live
gate, and only then commit. Keep one abstraction level per unit, directed
dependencies, no material duplication, and short reader-facing setup; fixtures
hide mechanics, never expected behavior. This section is authoritative; see
`AGENTS.md` and `REVIEW.md` for its scoped obligations.

After the frozen install, it validates formatting, strict typechecking, type-aware
lint, compiler-level unused locals/parameters, Knip dead exports, the
unit/contract/integration/package Vitest lanes with V8 coverage, the manifest-derived
dependency graph, build, Publint, ATTW, and an isolated packed consumer.

The full suite runs once through `test:cov`; individual lanes and `test` remain
available for development without coverage. Each lane requires tests. The package
lane proves that only the root entrypoint is public.

Run the frozen install after dependency or lockfile changes (`verify:lock` is an
alias). CI installs once before `verify`. Run `verify:negative` after changes to
the formatter, compiler, Knip, Publint, or their configuration; it checks deliberate
invalid fixtures and is not repeated for ordinary behavior changes.

Run `corepack pnpm verify:architecture` after boundary/configuration changes;
run `corepack pnpm verify:package` after package/export changes. Verification
creates only ignored build/coverage output and cleaned temporary directories.
Package verification builds once, checks removal of stale artifacts, and uses
one tarball for Publint, ATTW, exact source-derived inventory, and the isolated
consumer. Tooling-only changes preserve these guarantees and run the affected
checks; behavior-neutral refactors use existing behavioral tests.

The applicable smoke or live-provider gate is declared by the approved task or
route. After local validation, pull-request CI runs the frozen install, full
verification, Sonar branch or PR analysis, Quality Gate wait for pull requests,
and open-issue inspection when the token is available. Missing Sonar access is
not a pass. Release workflows are retained for approved release operations but
are not executed as part of ordinary development verification. Never report a
skipped, unavailable, or unselected gate as passed.
