# ADR-0010: Require consumer-warranted stable output ancestors

- Status: Accepted
- Date: 2026-07-30
- Amends: [ADR-0003](./0003-invocation-output-recording.md)
- Refines: [ADR-0008](./0008-real-mechanics-supervision-boundary.md)

## Context

ADR-0003 assigns output-path construction and retention to the consumer but says that the manager creates missing parent
directories. The AgentManager v1 draft also defers trust, symlink, realpath, mount, and provenance policy for those parents.
That combination leaves pathname resolution under mutable ancestors undefined and would let the package mutate a hierarchy it
does not own.

Path normalization, `realpath`, and containment checks do not establish that an ancestor remains the same object between
validation and later leaf, scratch, stream, result, cleanup, or directory-flush operations. Supporting ancestors that may be
renamed or replaced by an adversary would require a separate descriptor-relative/native capability design and filesystem
support matrix. V1 does not make that claim.

## Decision

The consumer owns and provisions the output hierarchy through the existing parent of the exact invocation leaf. Before
calling `start()`, it MUST ensure that every output ancestor is a trusted directory and MUST warrant that the ancestor
identity, symlink resolution, mount topology, and access policy remain stable until the manager reaches terminal filesystem
quiescence for that start.

The manager requires a normalized absolute output path, requires its immediate parent hierarchy to exist, and atomically
creates only the absent final directory leaf. A missing or non-directory parent fails preflight with
`revo.agent.output_path_invalid`. An existing final leaf, including a symlink, fails with
`revo.agent.output_conflict`. The manager never recursively creates output ancestors and retains ADR-0003's rules against
adoption, overwrite, deletion, rotation, or suffixing.

Terminal filesystem quiescence means that no package filesystem operation for the start remains pending. For a rejection
before leaf claim, it is reached when `start()` rejects. For a claimed leaf, it is reached only after all package recording,
publication, flush, scratch/temp cleanup attempts, and terminal filesystem append attempts have settled and the start has
rejected or the terminal result path has settled. If the manager reports or retains filesystem uncertainty, the warranty
continues until the consumer has externally reconciled that output path; elapsed time or process exit alone does not end it.

V1 relies on this consumer warranty. It does not use pathname checks to claim protection against hostile ancestor
replacement, does not prove consumer provenance, and does not promise hostile-ancestor support. Trusted stable ancestor
symlinks or mounts are consumer-certified topology, not package-certified containment. Filesystem cells still must prove the
required leaf-claim and result-publication primitives before they are supported. Workspace/CWD trust and containment remain
separate deferred decisions.

## Consequences

- The package mutates only the exact new invocation leaf and manager-owned paths inside it; it does not create consumer
  hierarchy.
- Consumers must provision and retain stable output ancestors for the whole package filesystem-operation lifetime, including
  late finalization after process exit.
- The exact-leaf race still has one winner, and existing evidence remains fail-closed.
- A pathname-only implementation is conforming only under the consumer warranty and cannot be described as hostile-ancestor
  safe.
- This ADR records target contract only. It adds no implementation, supported filesystem/platform cell, CI evidence, public
  export, or package publication.

## Rejected alternatives

- **Keep recursive parent creation under an implicit trust assumption:** mutates consumer hierarchy and leaves the trust
  lifetime undefined.
- **Treat normalization, `realpath`, or containment as a stable-capability proof:** leaves rename and symlink-replacement
  races between checks and later operations.
- **Claim hostile-ancestor support in v1:** requires a separately approved native descriptor-relative design and host/filesystem
  evidence.
- **Move output hierarchy ownership into the package:** crosses the consumer boundary established by ADR-0002 and ADR-0003.
