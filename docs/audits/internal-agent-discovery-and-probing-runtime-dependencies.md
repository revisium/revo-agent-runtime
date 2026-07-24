# Internal agent discovery and probing runtime dependency audit

This audit records reproducible evidence for the internal agent discovery and probing slice. It does not
represent a public package API or an online verification result by itself.

## Final dependency baseline

| Package        | Version | License      | Integrity                                                                                         |
| -------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `zod`          | 4.4.3   | MIT          | `sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==` |
| `ajv`          | 8.20.0  | MIT          | `sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==` |
| `canonicalize` | 3.0.0   | Apache-2.0   | `sha512-yYLfHyDMIXRyRqsKBRLX023riFLpXY2YOfdtqKXZRZy9qsfOJ9U+4F9YZL7MEzL5+ziN2x2nlBvY/Voi3EBljA==` |
| `fast-uri`     | 3.1.4   | BSD-3-Clause | `sha512-8JnbkQ4juDyvYs4mgFGQqg4yCYtFDtUtmp2QIQq11ZZe5CFQ5wcqm1rqDgAh/QdMySuBnPzMUiJUNZG5N/AiQw==` |

`ajv@8.20.0` declares `fast-uri: ^3.0.1`; the lockfile resolves exactly one `fast-uri@3.1.4`
package stanza. The workspace contains only the final `allowBuilds.esbuild: false` baseline. The Task 1 temporary
`minimumReleaseAgeExclude` exception is absent and expired; no dependency override, lockfile-trust escape, or
`minimumReleaseAge: 0` is accepted.

Installed manifests must have no `preinstall`, `install`, or `postinstall` hook. The dependency verifier also checks
the exact direct versions, lockfile integrities, and small Node ESM smoke imports.

## Advisory sources

The primary proof requests these public GitHub repository-advisory endpoints with a ten-second timeout and fails closed on
transport, status, JSON, or payload mismatches:

- `GHSA-4c8g-83qw-93j6` for npm `fast-uri`, high severity, with affected 3.x through 3.1.2;
- `GHSA-v2hh-gcrm-f6hx` for npm `fast-uri`, high severity, with `3.1.4` in its patched versions.

`pnpm audit --prod` is secondary registry evidence and cannot replace the primary advisory proof. This document makes no
claim that either online command passed for the current head; execution evidence belongs in the developer handoff.

## Reproduction

Run from the repository root with Node 24 and Corepack pnpm 11.13.0:

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm verify:internal-agent-discovery-and-probing:dependencies
corepack pnpm verify:internal-agent-discovery-and-probing:advisories
corepack pnpm audit --prod
```

The first verifier is offline after the frozen install. The second verifier is the mandatory online primary source; a
network, rate-limit, or endpoint failure is blocked evidence rather than a pass.
