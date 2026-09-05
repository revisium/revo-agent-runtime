# Repository contract

`@revisium/revo-agent-runtime` is a reusable, protocol-neutral runtime,
not an orchestrator, persistence layer, workflow engine, or provider login
manager.

## Source of truth

1. [docs/API.md](./docs/API.md) governs the current public API and behavior.
2. [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) governs responsibility and
   dependency direction.
3. Implemented source, tests, and the explicit `package.json` export map govern
   shipped behavior. Only the package root is public.
4. This file, `VERIFICATION.md`, and `REVIEW.md` govern local repository
   process.

## Dependency direction

Public contracts are portable leaves: no Node or ACP imports. Discovery
does not depend on application or manager code. Application and execution use
package-private ports and never concrete protocol/ACP adapters. Runtime siblings
do not depend on one another. All non-root source paths remain private unless
the export map deliberately changes.

Production source must not depend on tests, fixtures, scripts, generated output,
or repository tooling. Concrete Codex and Claude bridges are direct production
dependencies discovered and launched through their provider adapters.

`architecture/layers.json` is the executable dependency map. Dependency Cruiser
enforces that map, cycles, provider isolation, portable contracts, and private
session boundaries; TypeScript, Oxlint, and package checks cover complementary
source and publication constraints.

## Local workflow

Development uses feature branches and pull requests; CI verifies pushes and
pull requests with the frozen install, full verification, and configured Sonar
checks. Use TDD with reader-facing tests: RED, minimal GREEN, refactor,
targeted checks, and the authoritative `corepack pnpm verify`. A live provider
call is allowed only when the approved task or route selects its smoke gate;
use the existing launch context. The developer leaves changes uncommitted after
local gates and review; the integrator commits, pushes, and opens the pull
request. Remote CI and Sonar must pass on that pushed commit before merge.
Publishing and authentication changes require their release workflow.
