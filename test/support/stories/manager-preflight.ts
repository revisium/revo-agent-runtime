import { resolve } from 'node:path';

export const managerPreflightInvocation = (invocationId: string) => ({
  agent: { id: 'codex', version: '1.0.0', installationId: 'fixture-installation' },
  invocationId,
  output: { directory: resolve('/fixture/output') },
  parameters: {},
  permissions: {},
  prompt: 'Return a result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: resolve('/fixture/workspace') },
});
