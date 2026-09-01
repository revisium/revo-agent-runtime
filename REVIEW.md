# Review contract

Block a change when it:

- adds runtime behavior, public exports, or speculative module directories
  before their planned slice;
- changes the target API without reconciling `docs/API.md`;
- weakens strict TypeScript, type-aware lint, architecture, package, or
  lockfile checks;
- leaves an invalid negative fixture in the worktree or stops running it;
- lets production source import tests, scripts, generated output, Node/ACP from
  future contracts, concrete adapters from application/execution, application
  from discovery, or otherwise violates the directed dependency map enforced
  by the architecture gate;
- uses floating dependency ranges, peer/optional bridge dependencies, a global
  bridge requirement, implicit `latest`, credentials, or machine-local paths;
- claims a local, remote, live, or package gate passed without command evidence.

Apply the authoritative iteration delivery sequence in `VERIFICATION.md`; review
for readable reader-facing tests, one bounded responsibility per unit, the
smallest sufficient change, and a clean feature-branch pull-request handoff
with local and CI evidence.
