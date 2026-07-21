# ADR-0005: Use canonicalize for definition-identity canonical bytes

- Status: Accepted
- Date: 2026-07-21
- Refines: [ADR-0002](./0002-agent-manager-consumer-boundary.md)
- Related specification: [Internal definition canonical-byte adapter](../specs/definition-canonical-bytes.spec.md)

## Context

ADR-0002 fixes definition identity as lowercase SHA-256 over the exact UTF-8 bytes produced by RFC 8785 JSON
Canonicalization Scheme. Ordinary serialization and generic stable-stringify behavior do not provide that interoperable
byte contract. A package-local canonicalizer would also make this package responsible for subtle number, Unicode, and
object-ordering behavior already defined by the standard.

The selected implementation must be isolated from the rest of production code so provider behavior, input safety, and
failure handling remain reviewable at one boundary.

## Decision

Select the exact-pinned `canonicalize@3.0.0` package as the audited RFC 8785 canonicalization provider for definition
identity. The package will use it through one package-owned definition adapter, which is the sole production importer and
the only production path to JCS canonical bytes. It will not hand-roll canonicalization or introduce an alternative JCS
path.

The linked specification owns the adapter contract, input handling, sanitized failure behavior, and non-public boundary.

## Alternatives Considered

- Native JSON serialization: avoids a dependency but does not provide the required interoperable canonical byte contract.
- A generic stable-stringify package: can be repeatable for its own rules but does not guarantee RFC 8785 conformance.
- A package-owned canonicalizer: gives full control but adds avoidable security and interoperability risk in edge cases.
- Multiple provider-specific call sites: would distribute the identity boundary and make its audit and future replacement
  harder to review.

## Consequences

- Equivalent supported definitions can produce one portable digest, and a canonical-byte change changes identity.
- The exact dependency and its audit create an upgrade and re-audit obligation.
- Production canonicalization has one auditable integration point; the adapter is internal and does not create a package
  export.
- Consumers and other languages must implement the same RFC 8785 and SHA-256 contract to reproduce identity.
