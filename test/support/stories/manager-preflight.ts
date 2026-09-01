export const managerPreflightInvocation = (invocationId: string) => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: '/fixture/output' },
  parameters: {},
  permissions: {},
  prompt: 'Return a result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
});
