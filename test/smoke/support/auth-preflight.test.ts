import { expect, test } from 'vitest';

import { AgentManagerError } from '../../../src/index.js';
import {
  authFailureCode,
  expectedInstructionsChannel,
  isAuthFailure,
  probePreflightLine,
} from './auth-preflight.js';

test('classifies provider auth failures without treating timeout as auth', () => {
  expect(isAuthFailure(new Error('Failed to refresh OAuth token'))).toBe(true);
  expect(isAuthFailure(new Error('opencode exact-context cached-login preflight failed'))).toBe(
    true,
  );
  expect(
    isAuthFailure(
      new AgentManagerError({
        code: 'revo.agent.protocol_failed',
        message: 'Authentication required. Please log in.',
        phase: 'execution',
        retryable: false,
      }),
    ),
  ).toBe(true);
  expect(
    authFailureCode(
      new AgentManagerError({
        code: 'revo.agent.protocol_failed',
        message: 'Authentication required. Please log in.',
        phase: 'execution',
        retryable: false,
      }),
    ),
  ).toBe('revo.agent.protocol_failed');
  expect(
    isAuthFailure(
      new AgentManagerError({
        code: 'revo.agent.timeout',
        message: 'The agent invocation timed out.',
        phase: 'running',
        retryable: false,
      }),
    ),
  ).toBe(false);
  expect(
    isAuthFailure({
      code: 'revo.agent.protocol_failed',
      message: 'unauthorized',
      phase: 'execution',
      retryable: false,
    }),
  ).toBe(true);
});

test('selects native OpenCode and prefix channels from public identity only', () => {
  expect(expectedInstructionsChannel('grok-acp', '1.0.0')).toBe('acp:session/prompt.prefix');
  expect(expectedInstructionsChannel('codex-acp', '1.7.0')).toBe('acp:session/prompt.prefix');
  expect(expectedInstructionsChannel('opencode-acp', '1.18.22')).toBe('acp:session/prompt.prefix');
  expect(expectedInstructionsChannel('claude-acp', '2.0.0')).toBe(
    'acp:session/new._meta.systemPrompt.append',
  );
  if (process.platform !== 'win32') {
    expect(expectedInstructionsChannel('opencode-acp', '1.18.23')).toBe(
      'opencode:config.instructions-file',
    );
  }
});

test('probe preflight lines omit executable paths', () => {
  expect(
    probePreflightLine('opencode-acp', {
      agent: { id: 'opencode-acp', version: '1.0.0', installationId: 'fixture-installation' },
      definitionDigest: 'digest',
      executable: '/usr/bin/opencode',
      reportedVersion: '1.18.23',
      status: 'available',
    }),
  ).toBe('opencode-acp: probe=available; reportedVersion=1.18.23');
});
