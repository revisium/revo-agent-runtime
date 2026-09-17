import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import type {
  AgentInvocationFailed,
  AgentInvocationResult,
  AgentSessionEvent,
  AgentSessionPermissionOption,
} from '../../../src/index.js';
import {
  answerFixtureEchoPermissions,
  assertLivePath,
  authSourceLine,
  combinedInstructions,
  combinedInvocationPrompt,
  declaredAuthSource,
  invocationNonceObserved,
  jsonOnlyInvocationPrompt,
  mcpOnlySessionPrompt,
  retainFixtureOutput,
  sessionObserverSawTool,
  summarizeInvocationDiagnostics,
  summarizeInvocationFault,
  summarizeSessionDiagnostics,
  textShowsMcpTool,
  textShowsNonce,
  uniqueSessionId,
} from './live-context-evidence.js';

const succeeded = (value: Record<string, unknown>): AgentInvocationResult => ({
  acceptedAt: '2026-09-12T00:00:00.000Z',
  durationMs: 1,
  exit: { code: 0, signal: null },
  files: {
    directory: '/output',
    events: 'events.ndjson',
    result: 'result.json',
    stderr: 'stderr.log',
    stdout: 'stdout.log',
  },
  finishedAt: '2026-09-12T00:00:01.000Z',
  invocationId: 'inv',
  launch: { executable: '/bin/false', reportedVersion: '1' },
  pin: { agentId: 'grok-acp', agentVersion: '1.0.0', definitionDigest: 'digest' },
  schemaVersion: 'agent-invocation-result/v1',
  status: 'succeeded',
  value,
});

const permissionEvent = (
  title: string,
  options: readonly AgentSessionPermissionOption[],
  kind: 'execute' | 'edit' | 'other' = 'execute',
  requestId = 'req_echo',
): AgentSessionEvent =>
  ({
    eventId: 'evt_1',
    observedAt: '2026-09-13T00:00:00.000Z',
    request: {
      action: { kind, title },
      kind: 'permission',
      options,
      requestId,
    },
    scope: { kind: 'turn', turnId: 'trn_context' },
    sessionId: 'dlg_test',
    type: 'interaction.requested',
  }) as unknown as AgentSessionEvent;

test('auth source is an explicit declaration, not inferred from HOME or catalog', () => {
  expect(declaredAuthSource(undefined)).toBe('undeclared');
  expect(declaredAuthSource('HOME')).toBe('undeclared');
  expect(declaredAuthSource('cached-login')).toBe('cached-login');
  expect(authSourceLine('opencode-acp', ['HOME', 'PATH'], 386, 'cached-login')).toBe(
    'opencode-acp: authSource=cached-login; inherit=HOME,PATH; inspectConfiguration=same-context; catalogModels=386; catalog=capability-not-auth',
  );
  expect(authSourceLine('codex-acp', ['HOME'], 6, 'undeclared')).toContain('authSource=undeclared');
});

test('instruction-nonce prompts do not embed the nonce value', () => {
  const nonce = 'nonce-secret-value';
  expect(combinedInstructions(nonce)).toContain(nonce);
  expect(combinedInvocationPrompt()).not.toContain(nonce);
  expect(jsonOnlyInvocationPrompt()).not.toContain(nonce);
  expect(mcpOnlySessionPrompt()).not.toContain(nonce);
});

test('invocation nonce is observed in JSON or captured outputs', () => {
  expect(invocationNonceObserved(succeeded({ ok: true }), '', 'nonce-1')).toBe(false);
  expect(invocationNonceObserved(succeeded({ ok: true, nonce: 'nonce-1' }), '', 'nonce-1')).toBe(
    true,
  );
  expect(invocationNonceObserved(succeeded({ ok: true }), 'prefix nonce-1', 'nonce-1')).toBe(true);
});

test('mcp tool evidence requires the fixture echo payload, not a mention regex', () => {
  expect(textShowsMcpTool('hello', 'nonce-1')).toBe(false);
  expect(
    textShowsMcpTool(
      'You must call the knowledge MCP echo tool with text exactly nonce-1.',
      'nonce-1',
    ),
  ).toBe(false);
  expect(textShowsMcpTool('{"type":"tool.activity","title":"echo"}', 'nonce-1')).toBe(false);
  expect(textShowsMcpTool('echo:nonce-1', 'nonce-1')).toBe(true);
  expect(textShowsNonce('Repeat nonce-1', 'nonce-1')).toBe(true);
  expect(sessionObserverSawTool([{ type: 'tool.activity' } as unknown as AgentSessionEvent])).toBe(
    true,
  );
  expect(sessionObserverSawTool([{ type: 'session.opened' } as unknown as AgentSessionEvent])).toBe(
    false,
  );
});

test('live path assertions fail closed on missing nonce, tool, or delivery', () => {
  const base = {
    delivery: 'acp:session/prompt.prefix',
    expected: 'acp:session/prompt.prefix',
    nonceObserved: true,
    status: 'succeeded',
    toolObserved: true,
  };
  expect(() => assertLivePath('invocation', base)).not.toThrow();
  expect(() => assertLivePath('invocation', { ...base, nonceObserved: false })).toThrow(
    /nonce missing/,
  );
  expect(() => assertLivePath('invocation', { ...base, toolObserved: false })).toThrow(
    /mcp tool missing/,
  );
  expect(() => assertLivePath('invocation', { ...base, delivery: 'omitted' })).toThrow(
    /delivery omitted/,
  );
  expect(() =>
    assertLivePath('invocation', {
      ...base,
      faultCode: 'revo.agent.result_invalid_json',
      status: 'failed',
    }),
  ).toThrow(/status failed revo.agent.result_invalid_json/);
  expect(() => assertLivePath('session', { ...base, status: 'completed' })).not.toThrow();
});

test('failed invocation faults print code, phase, duration, and bounded preview', () => {
  const failed: AgentInvocationFailed = {
    ...succeeded({}),
    error: {
      code: 'revo.agent.result_invalid_json',
      message: 'The agent result is not valid UTF-8 JSON.',
      phase: 'collecting_result',
      retryable: false,
    },
    rawResponse: {
      byteLength: 12,
      preview: '{"ok":true} extra',
      retainedByteLength: 12,
      truncated: false,
    },
    status: 'failed',
  };
  expect(summarizeInvocationFault(failed)).toBe('revo.agent.result_invalid_json/collecting_result');
  expect(summarizeInvocationDiagnostics(failed)).toContain('durationMs=1');
  expect(summarizeInvocationDiagnostics(failed)).toContain('preview=');
  expect(summarizeSessionDiagnostics({ status: 'failed', error: failed.error }, 'idle')).toBe(
    'status=failed; fault=revo.agent.result_invalid_json/collecting_result; terminal=idle',
  );
});

test('session permission helper allows only the fixture echo tool once', async () => {
  const responses: unknown[] = [];
  const session = {
    respond: async (input: unknown) => {
      responses.push(input);
      return { state: 'accepted' as const };
    },
  };
  const options = [
    { kind: 'allow_once' as const, label: 'Allow once', optionId: 'allow-once' },
    { kind: 'reject_once' as const, label: 'Reject', optionId: 'reject-once' },
  ];
  const answered = new Set<string>();
  await answerFixtureEchoPermissions(
    session,
    [permissionEvent('echo', options, 'execute', 'req_execute')],
    answered,
  );
  await answerFixtureEchoPermissions(
    session,
    [permissionEvent('echo', options, 'edit', 'req_edit')],
    answered,
  );
  await answerFixtureEchoPermissions(
    session,
    [permissionEvent('echo', options, 'other', 'req_other')],
    answered,
  );
  await answerFixtureEchoPermissions(
    session,
    [permissionEvent('knowledge_echo', options, 'other', 'req_alt')],
    answered,
  );
  expect(answered).toEqual(new Set(['req_execute', 'req_edit', 'req_other', 'req_alt']));
  expect(responses).toEqual([
    {
      requestId: 'req_execute',
      response: { kind: 'permission', optionId: 'reject-once', outcome: 'selected' },
    },
    {
      requestId: 'req_edit',
      response: { kind: 'permission', optionId: 'reject-once', outcome: 'selected' },
    },
    {
      requestId: 'req_other',
      response: { kind: 'permission', optionId: 'reject-once', outcome: 'selected' },
    },
    {
      requestId: 'req_alt',
      response: { kind: 'permission', optionId: 'reject-once', outcome: 'selected' },
    },
  ]);
});

test('session permission helper never selects allow_once by title echo', async () => {
  const responses: unknown[] = [];
  const session = {
    respond: async (input: unknown) => {
      responses.push(input);
      return { state: 'accepted' as const };
    },
  };
  await answerFixtureEchoPermissions(
    session,
    [
      permissionEvent(
        'echo',
        [{ kind: 'allow_once', label: 'Allow once', optionId: 'allow-once' }],
        'execute',
        'req_only_allow',
      ),
    ],
    new Set(),
  );
  expect(responses).toEqual([
    {
      requestId: 'req_only_allow',
      response: { kind: 'permission', outcome: 'denied' },
    },
  ]);
});

test('retains only fixture output files into a private evidence directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-live-evidence-'));
  const source = await mkdtemp(join(tmpdir(), 'revo-live-source-'));
  const secret = 'K7mQ2pL9vX4nR8wZ3cF1';
  await writeFile(join(source, 'result.json'), '{"ok":true}', { mode: 0o600 });
  await writeFile(join(source, 'secret.env'), 'must-not-copy', { mode: 0o600 });
  await writeFile(join(source, 'stdout.log'), `agent_thought_chunk ${secret}`, { mode: 0o600 });
  await writeFile(
    join(source, 'events.ndjson'),
    JSON.stringify({ sessionUpdate: 'agent_thought_chunk', content: { text: secret } }),
    { mode: 0o600 },
  );
  const retained = await retainFixtureOutput(root, 'opencode-acp/invocation', source);
  await expect(stat(join(retained, 'result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(stat(join(retained, 'stdout.log'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(stat(join(retained, 'events.ndjson'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(stat(join(retained, 'secret.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  const diagnostic = JSON.parse(await readFile(join(retained, 'diagnostic.json'), 'utf8')) as {
    readonly assistantPreview?: string;
  };
  expect(JSON.stringify(diagnostic)).not.toContain(secret);
  expect(JSON.stringify(diagnostic)).not.toContain('agent_thought_chunk');
  // Windows does not expose POSIX file permission bits.
  if (process.platform !== 'win32') {
    expect((await stat(retained)).mode & 0o777).toBe(0o700);
    expect((await stat(join(retained, 'diagnostic.json'))).mode & 0o777).toBe(0o600);
  }
});

test('session ids include a per-run nonce', () => {
  expect(uniqueSessionId('grok-acp', 'run1')).toBe('dlg_grok-acp_context_run1');
  expect(uniqueSessionId('grok-acp', 'run1')).not.toBe(uniqueSessionId('grok-acp', 'run2'));
});
