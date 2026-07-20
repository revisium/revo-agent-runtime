# M1 runtime dependency audit

This audit records the exact production dependency artifacts selected for the internal M1 identity and discovery slice.
The lockfile and installed-tree verifier are the reproducible evidence; dependency upgrades require a new review of the
same evidence classes.

## Artifacts

| Package              | Registry tarball                                                   | SHA-512 integrity                                                                                 | License      | Source/provenance                                                                                          |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `zod@4.4.3`          | `https://registry.npmjs.org/zod/-/zod-4.4.3.tgz`                   | `sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==` | MIT          | `colinhacks/zod`; npm SLSA provenance attestation present                                                  |
| `ajv@8.20.0`         | `https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz`                  | `sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==` | MIT          | `ajv-validator/ajv`; signed registry artifact, no provenance attestation advertised in version metadata    |
| `canonicalize@3.0.0` | `https://registry.npmjs.org/canonicalize/-/canonicalize-3.0.0.tgz` | `sha512-yYLfHyDMIXRyRqsKBRLX023riFLpXY2YOfdtqKXZRZy9qsfOJ9U+4F9YZL7MEzL5+ziN2x2nlBvY/Voi3EBljA==` | Apache-2.0   | `erdtman/canonicalize`; signed registry artifact, no provenance attestation advertised in version metadata |
| `fast-uri@3.1.4`     | `https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.4.tgz`         | `sha512-8JnbkQ4juDyvYs4mgFGQqg4yCYtFDtUtmp2QIQq11ZZe5CFQ5wcqm1rqDgAh/QdMySuBnPzMUiJUNZG5N/AiQw==` | BSD-3-Clause | `fastify/fast-uri`; signed registry artifact                                                               |

## Runtime dependency graph

```text
@revisium/revo-agent-runtime
├── zod@4.4.3 (no runtime dependencies)
├── canonicalize@3.0.0 (no runtime dependencies; Node >=18; ESM+types export)
└── ajv@8.20.0
    ├── fast-deep-equal@3.1.3
    ├── fast-uri@3.1.4 (resolved naturally from Ajv's ^3.0.1; no override)
    ├── json-schema-traverse@1.0.0
    └── require-from-string@2.0.2
```

The installed manifests have no `preinstall`, `install`, or `postinstall` lifecycle hooks. Source packages contain
development or publication scripts that do not run during consumer installation. Of the direct dependencies,
`canonicalize` alone declares a Node engine (`>=18`), which is compatible with this package's Node 24 contract. The
installed-tree audit exercises the supported ESM imports and TypeScript declarations are covered by repository typecheck.
Ajv declares exactly `fast-uri: ^3.0.1`; the lock selects the audited 3.1.4 artifact through that range, and the workspace
contains no dependency override.

The workspace temporarily contains `minimumReleaseAgeExclude: [fast-uri@3.1.4]`. Task 1's dependency owner owns this
narrow exception so the critical High security hotfix can replace vulnerable 3.1.2 before the ordinary release-age window
closes. It neither trusts the lockfile nor disables `minimumReleaseAge`. Remove it after 2026-07-20 10:43 Europe/Moscow
(07:43Z) and before Task 13 or final M1 closure; Task 13 owns that removal check.

## Primary advisory evidence

The mandatory online audit reads the two exact public GitHub repository-advisory endpoints with a ten-second timeout and
fails closed on transport errors, invalid JSON, non-200 responses, or changed payload values. It uses no credential and
does not paginate or retry:

- `GHSA-4c8g-83qw-93j6` is published with high severity for npm `fast-uri`; its observed vulnerable range is
  `>= 2.3.1 <2.4.2; 3.0.0 <= 3.1.2; 4.0.0`, and its patched versions are `2.4.2; 3.1.3; 4.0.1`.
- `GHSA-v2hh-gcrm-f6hx` is published with high severity for npm `fast-uri`; its observed vulnerable range is
  `>= 2.3.1, <= 2.4.2; >= 3.0.0, <= 3.1.3; >= 4.0.0, <= 4.1.0`, and its patched versions are
  `2.4.3; 3.1.4; 4.1.1`.

The latter advisory is the primary evidence that 3.1.4 patches the affected 3.x range through 3.1.3. The registry-backed
`pnpm audit --prod` result is secondary evidence because its advisory feed may lag these primary records.

## Reproduction

Run from the repository root with Node 24 and Corepack pnpm 11.13.0:

```bash
corepack pnpm view zod@4.4.3 dist repository license engines scripts dependencies --json
corepack pnpm view ajv@8.20.0 dist repository license engines scripts dependencies --json
corepack pnpm view canonicalize@3.0.0 dist repository license engines scripts dependencies --json
corepack pnpm view fast-uri@3.1.4 dist repository license engines scripts dependencies --json
corepack pnpm install --frozen-lockfile --ignore-scripts
node --import tsx scripts/verify-m1-dependencies.ts
corepack pnpm why zod ajv canonicalize fast-uri
node --import tsx scripts/verify-m1-advisories.ts
corepack pnpm audit --prod
```

The frozen install must execute no dependency lifecycle scripts. The installed-tree audit verifies exact versions,
licenses, lockfile integrities, absent install lifecycle hooks, Ajv's declared range and natural `fast-uri@3.1.4`
resolution, and minimal Node ESM runtime behavior. Both the primary advisory check and the secondary production advisory
command must exit zero before this dependency set is accepted.

## Verification record

On 2026-07-20, the commands above were run with Node 24.18.0 and Corepack pnpm 11.13.0. The frozen install completed with
`--ignore-scripts` while retaining the active supply-chain policy and its one approved exception. The installed-tree audit
passed; `pnpm why` reported one version of each audited package with `fast-uri@3.1.4` only below `ajv@8.20.0`; the exact
primary advisory check passed for both listed GHSA records; and the secondary production advisory audit reported no known
vulnerabilities.
