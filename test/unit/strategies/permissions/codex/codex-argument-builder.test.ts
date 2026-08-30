import { expect, test } from 'vitest';

import { buildCodexExecArguments } from '../../../../../src/strategies/permissions/codex/codex-argument-builder.js';
import { mapCodexPermissions } from '../../../../../src/strategies/permissions/codex/codex-permission-strategy.js';

test('maps bounded Codex permissions and arguments deterministically', () => {
  expect(mapCodexPermissions({ sandbox: 'workspace-write', network: 'enabled' })).toEqual({
    sandboxFlag: '--sandbox=workspace-write',
    config: ['--config', 'sandbox_workspace_write.network_access=true'],
  });
  expect(
    buildCodexExecArguments({
      prompt: 'hello',
      sandbox: 'read-only',
      network: 'disabled',
      model: 'o3',
      outputSchema: '{"type":"object"}',
    }),
  ).toEqual([
    '--ask-for-approval=never',
    'exec',
    '--json',
    '--output-schema',
    '{"type":"object"}',
    '--sandbox=read-only',
    '--config',
    'sandbox_workspace_write.network_access=false',
    '--model',
    'o3',
    'hello',
  ]);
});

test('rejects unsafe or unbounded Codex permission inputs', () => {
  expect(() => mapCodexPermissions({ sandbox: 'danger-full-access', network: 'disabled' })).toThrow(
    'explicit admission',
  );
  expect(() => mapCodexPermissions({ sandbox: 'read-only', network: 'enabled' })).toThrow(
    'no approved mapping',
  );
  expect(() =>
    buildCodexExecArguments({ prompt: '', sandbox: 'read-only', network: 'disabled' }),
  ).toThrow('bounded');
  expect(() =>
    buildCodexExecArguments({
      prompt: 'x',
      model: '\u0000',
      sandbox: 'read-only',
      network: 'disabled',
    }),
  ).toThrow('bounded');
});
