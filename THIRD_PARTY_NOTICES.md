# Third-party bridge notices

This package installs the following exact bridge chain as production
dependencies. The integrity values are the npm package checksums recorded by
the frozen `pnpm-lock.yaml`; installed package manifests are the license source.
Dependency source is not copied into the Revo tarball.

| Package                                 | Version   | Relationship                         | Declared license           | Lockfile integrity                                                                                |
| --------------------------------------- | --------- | ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/codex-acp`        | `1.7.0`   | direct Codex ACP bridge              | Apache-2.0                 | `sha512-+nUhAJyunx8Zc7r3jjLPoMPPUkkk02TmBIosln4l+ugRNUOdNQAMm6toZo7xb+mF1yM5zxJB83qvy/bPmOTaaw==` |
| `@openai/codex`                         | `0.148.0` | Codex bridge dependency (`^0.148.0`) | Apache-2.0                 | `sha512-bh5kH9+BMrFaHGmLeoSansPdfRksvr4UXzjQInns/KRO7r8VJ+6AAW+SqUsE8XcG3+OW/mI4EEy8Gpo9UDXGvQ==` |
| `@agentclientprotocol/claude-agent-acp` | `0.70.0`  | direct Claude ACP bridge             | Apache-2.0                 | `sha512-Psqj6fhV4pQ8IM480zpJ+xGiMMIqNLxlsTj5Mzn+T8KSURCVNJdl0ktcqLMjgHJC/QnOvDdDkFf3xTW9VIV9aQ==` |
| `@anthropic-ai/claude-agent-sdk`        | `0.3.232` | exact Claude bridge dependency       | `SEE LICENSE IN README.md` | `sha512-8od7hJk9fZnF1/oYYiR9PvroGbZRQrpmNgKirjHNGoj5ur5YcAZLohI70XVUAUe3KvjB1msLxtkvmlAT9sqFAg==` |

The installed Codex and Claude bridge packages include their Apache-2.0 license
files. The installed Claude Agent SDK includes `LICENSE.md`, which states that
Anthropic retains all rights and makes use subject to its linked legal
agreements. That restricted license is an unresolved human release/legal gate:
the runtime must not be published or redistributed with the Claude dependency
until the intended use has been approved. This notice records the issue; it
does not grant rights or waive the upstream terms.
