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

Every change follows one required sequence: RED behavior test, minimal GREEN
production change, production readability refactor, test/fixture readability
refactor, architecture/package/full gate, then the applicable smoke or live
gate, and only then commit. Keep one abstraction level per unit, directed
dependencies, no material duplication, and short reader-facing setup; fixtures
hide mechanics, never expected behavior. This section is authoritative; see
`AGENTS.md` and `REVIEW.md` for its scoped obligations.

It validates the frozen lockfile, formatting, strict typechecking, type-aware
lint, compiler-level unused locals/parameters, Knip dead exports, the
unit/contract/integration/package Vitest lanes, V8 coverage,
deliberate negative format/type/package-export evidence, the manifest-derived
dependency graph, build, Publint, ATTW, and an isolated packed consumer.

The unit, contract, and integration lanes accept no tests only until a behavior
slice owns them. The package lane proves that only the planned root entrypoint
is public. This is explicit incremental-delivery policy, not simulated test
coverage.

Run `corepack pnpm verify:architecture` after boundary/configuration changes;
run `corepack pnpm verify:package` after package/export changes. Verification
creates only ignored build/coverage output and cleaned temporary directories.

The applicable smoke or live-provider gate is declared by the approved task or
route. After local validation, pull-request CI runs the frozen install, full
verification, Sonar branch or PR analysis, Quality Gate wait for pull requests,
and open-issue inspection when the token is available. Missing Sonar access is
not a pass. Release workflows are retained for approved release operations but
are not executed as part of ordinary development verification. Never report a
skipped, unavailable, or unselected gate as passed.
