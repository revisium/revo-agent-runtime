# Third-party adapter notices

The package includes JavaScript builds of these pinned ACP adapters. Their source
packages are build dependencies; the consumer does not install their dependency
trees. `adapters/NOTICE.txt` contains bundled dependency license texts, and legal
comments remain in the generated JavaScript. The frozen `pnpm-lock.yaml` records
source package integrity.

| Package                                 | Version   | Use                                      | Declared license         |
| --------------------------------------- | --------- | ---------------------------------------- | ------------------------ |
| `@agentclientprotocol/codex-acp`        | `1.7.0`   | Codex ACP adapter                        | Apache-2.0               |
| `@agentclientprotocol/claude-agent-acp` | `0.70.0`  | Claude ACP adapter                       | Apache-2.0               |
| `@anthropic-ai/claude-agent-sdk`        | `0.3.232` | JavaScript SDK within the Claude adapter | SEE LICENSE IN README.md |

No Codex or Claude CLI executable is bundled or installed by this package.
Users provide their own CLI installation; the runtime explicitly binds its path.

The Claude Agent SDK's `LICENSE.md` states that Anthropic retains all rights and
makes use subject to its linked legal agreements. The existing unresolved human
release/legal gate still applies: do not publish or redistribute this package
with the Claude SDK until the intended use has been approved. This notice does
not grant rights or waive upstream terms.
