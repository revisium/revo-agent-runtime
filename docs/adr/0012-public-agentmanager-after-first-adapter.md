# ADR-0012: Publish the provider-neutral AgentManager after the first supported adapter

- Status: Accepted
- Date: 2026-08-02
- Refines: [ADR-0001](./0001-agent-runtime-boundary.md), [ADR-0002](./0002-agent-manager-consumer-boundary.md)
- Related: [ADR-0011](./0011-consumer-governed-local-supervision.md)

## Context

The delivery plan originally withheld the public root export until native Codex, native Claude, and ACP had each
instantiated the shared conformance harness. The intent was to prevent any single provider from shaping the contract:
requiring three independent adapters to pass the same harness was the mechanism that kept the AgentManager surface
provider-neutral.

That mechanism now has a more direct replacement. A frozen, provider-neutral real-process harness is being completed as
its own responsibility, ahead of any adapter. Once that harness exists, it enforces neutrality on its own terms, and a
single adapter instantiating it does not bias the contract toward that adapter's mechanics. Holding the export back
behind two further adapters, whose provider versions, wire evidence, and authentication modes are not yet decided, delays
every consumer of the package without adding further protection against provider bias.

The current three-adapter gate is also expensive to keep as written: it postpones any consumer value indefinitely behind
work that has no committed timeline, and it conflates two claims that a release can state independently: whether the
public contract is complete, and whether provider coverage is complete.

## Decision

The provider-neutral AgentManager contract may be published once the shared core, its filesystem and output layer, the
frozen real-process harness, and one supported provider adapter have each passed their required evidence. The first
supported adapter is native Codex. The published surface must remain fully provider-neutral: it exposes no
provider-specific type, entrypoint, convenience API, or lifecycle contract tied to Codex or any other provider.

Native Claude and ACP remain required adapters to that same published contract and are delivered afterward, using the
same harness and the same wire-specific evidence standard as Codex. Completion of the public contract and completion of
provider coverage become two separate claims, each stated on its own terms; neither substitutes for the other in release
communication.

If a later adapter cannot be instantiated against the already-published contract without changing it, that is a contract
defect. Resolving it requires its own decision record and human approval, not an incremental adjustment to the published
surface.

## Alternatives considered

- Keep the three-adapter gate as originally written: preserves the strongest neutrality guarantee available before the
  harness existed, but ties all consumer value to Claude and ACP timelines that are not yet committed, and no longer adds
  protection once the frozen harness carries that role directly.
- Export a Codex-specific surface now and generalize it once Claude and ACP land: was rejected because it lets one
  provider's mechanics leak into the only public contract the package will ever have had at that point, which is the
  exact outcome the original three-adapter gate existed to prevent.
- Publish an explicitly experimental or unstable subpath ahead of the stable contract: was rejected because it creates a
  second public path to the same capability, which the package's ownership boundary does not otherwise allow.

## Consequences

- Consumers can bind to the AgentManager contract as soon as one adapter proves it, instead of waiting on Claude and ACP
  timelines.
- The package accepts a real trade-off: the contract is frozen while validated against only one provider's behavior. If
  Claude or ACP later need a shape the frozen harness and Codex evidence did not exercise, that surfaces only after
  publication, as a contract defect rather than a pre-publication finding.
- Every release must state contract completeness and provider coverage as two distinct facts; a release cannot describe
  itself as done in one sense and imply the other.
- The "no single provider shapes the contract" protection now depends entirely on the real-process harness being frozen
  and provider-neutral before Codex is evaluated against it. If that harness is incomplete or leaks Codex-specific
  assumptions, this decision's premise does not hold and would need to be revisited.

## Open questions

- Whether publishing the contract at this gate is limited to adding the curated root export in a package that stays
  otherwise unpublished, or also authorizes publishing the package itself to a public registry, is not decided here.
- Whether the published contract carries a stable major-version guarantee immediately, or an explicitly pre-stable
  version until Claude and ACP have both instantiated it, is not decided here.
