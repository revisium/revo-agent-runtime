# Provider diagnostics PoC

The deterministic harness in `test/contract/protocol/provider-diagnostics.contract.test.ts`
uses the public `createAgentManager` API and the existing fake ACP child. The live
runner in `scripts/provider-diagnostics-poc.ts` uses the same session API and a
temporary launch wrapper. Neither changes the runtime public API or adds a logger.

Run the focused PoC with:

```bash
corepack pnpm exec vitest run test/contract/protocol/provider-diagnostics.contract.test.ts --pool=forks --maxWorkers=1
```

The artifact records `caseId`, exact agent id/version, phase, source (`acp.error`,
`stderr`, `exit`, or `runtime.fault`), bounded message/data, and the public result.
The fake `rpc-error` case preserves a nested ACP error in the capture while the
runtime result remains `revo.agent.protocol_failed`. The stderr case writes a secret
across two chunks and proves redaction after reassembly. EOF is recorded separately
from the public fault. Raw traces remain in the temporary directory and are never
checked in.

Live-provider collection uses the approved matrix and an existing authenticated
environment. The wrapper forwards stdin/stdout bytes unchanged, keeps stderr
separate, captures bounded redacted ACP observations, writes its sidecar atomically
before forwarding child exit, and preserves the discovered launch command/version
probe. Child and wrapper exits are recorded separately; wrapper-induced process or
cleanup effects remain a PoC limitation.

Run the selected matrix with:

```bash
corepack pnpm exec tsx scripts/provider-diagnostics-poc.ts \
  /tmp/revo-provider-error-poc/matrix.provisional.json \
  /tmp/revo-provider-error-poc/runs
```

The command runs cases sequentially, creates no session output directory ahead of
the runtime's atomic claim, and enforces the matrix's five-prompt total and
90-second per-case deadline across discovery, inspection, opening, and the turn.
Cleanup has a separate bounded wait and is reported independently. It inspects a
fresh catalog and applies only advertised explicit overrides before opening a
public multi-turn session. It performs no retries or authentication/configuration
mutations.

The matrix input is one JSON object per case, for example:

```json
{
  "execution": {
    "maxActualPromptTurns": 5,
    "maxDurationMsPerCase": 90000,
    "retries": 0
  },
  "cases": [
    {
      "id": "codex-default",
      "agentId": "codex-acp",
      "maxPromptTurns": 1,
      "prompt": "Reply with pong.",
      "selection": { "overrides": {} }
    }
  ]
}
```

Each case records the fresh runtime revision, definition pin/digest, catalog
revision and option counts, phase, wrapper and child exit observations, ACP error
envelopes, stop reasons, failed tool-call updates, and a bounded public outcome.
Normal assistant text, prompts, full catalog values, and environment variables are
not diagnostic evidence.
