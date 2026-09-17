import { mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import type { AgentSessionEvent } from '../../../src/index.js';
import {
  fixtureMcpEvidence,
  livePathVerdict,
  parseAllowlistedProtocolEvents,
  readFixtureServerAudit,
  retainSafeLiveDiagnostic,
  uniqueFixtureSecret,
} from './live-context-evidence.js';

const toolEvent = (title: string): AgentSessionEvent =>
  ({
    eventId: 'evt_tool',
    kind: 'other',
    observedAt: '2026-09-13T00:00:00.000Z',
    status: 'completed',
    title,
    toolCallId: 'call_echo',
    turnId: 'trn_context',
    type: 'tool.activity',
  }) as unknown as AgentSessionEvent;

test('fixture secrets are unique high-entropy values of at least 16 characters', () => {
  const first = uniqueFixtureSecret();
  const second = uniqueFixtureSecret();
  expect(first).not.toBe(second);
  expect(first.length).toBeGreaterThanOrEqual(16);
  expect(second.length).toBeGreaterThanOrEqual(16);
  expect(first).toMatch(/^[A-Za-z0-9]+$/);
});

test('assistant echo and forged tool mentions are not MCP evidence', () => {
  const nonce = 'Nq8vL2mR7wK4pX9cZ1aB';
  expect(
    fixtureMcpEvidence({
      audit: [],
      correlationId: 'inv-1',
      events: [toolEvent('echo')],
      nonce,
      outputs: `echo:${nonce}`,
    }),
  ).toBe(false);
  expect(
    fixtureMcpEvidence({
      audit: [
        {
          correlationId: 'inv-other',
          method: 'tools/call',
          name: 'echo',
          text: nonce,
        },
      ],
      correlationId: 'inv-1',
      events: [toolEvent('echo')],
      nonce,
      outputs: `echo:${nonce}`,
    }),
  ).toBe(false);
  expect(
    fixtureMcpEvidence({
      audit: [{ correlationId: 'inv-1', method: 'tools/call', name: 'echo', text: nonce }],
      correlationId: 'inv-1',
      events: [],
      nonce,
      outputs: `echo:${nonce}`,
    }),
  ).toBe(false);
  expect(
    fixtureMcpEvidence({
      audit: [{ correlationId: 'inv-1', method: 'tools/call', name: 'echo', text: nonce }],
      correlationId: 'inv-1',
      events: [toolEvent('echo')],
      nonce,
      outputs: '',
    }),
  ).toBe(true);
});

test('namespaced fixture tool titles require the same correlated server audit', () => {
  const nonce = 'Nq8vL2mR7wK4pX9cZ1aB';
  const input = {
    audit: [
      { correlationId: 'inv-1', method: 'tools/call' as const, name: 'echo' as const, text: nonce },
    ],
    correlationId: 'inv-1',
    nonce,
    outputs: '',
  };
  expect(fixtureMcpEvidence({ ...input, events: [toolEvent('mcp.knowledge.echo')] })).toBe(true);
  expect(fixtureMcpEvidence({ ...input, events: [toolEvent('knowledge_echo')] })).toBe(true);
  expect(fixtureMcpEvidence({ ...input, events: [toolEvent('knowledge__echo')] })).toBe(true);
  expect(fixtureMcpEvidence({ ...input, events: [toolEvent('mcp__knowledge__echo')] })).toBe(true);
  expect(
    fixtureMcpEvidence({ ...input, audit: [], events: [toolEvent('mcp.knowledge.echo')] }),
  ).toBe(false);
  expect(fixtureMcpEvidence({ ...input, events: [toolEvent('mcp.other.echo')] })).toBe(false);
});

test('permission-required live paths are blocked, not successful', () => {
  const passing = {
    delivery: 'acp:session/prompt.prefix',
    expected: 'acp:session/prompt.prefix',
    nonceObserved: true,
    permissionRequested: false,
    status: 'succeeded' as const,
    toolObserved: true,
  };
  expect(livePathVerdict('invocation', passing)).toBe('passed');
  expect(livePathVerdict('invocation', { ...passing, permissionRequested: true })).toBe('blocked');
  expect(livePathVerdict('session', { ...passing, status: 'completed' })).toBe('passed');
  expect(
    livePathVerdict('session', {
      ...passing,
      permissionRequested: true,
      status: 'completed',
    }),
  ).toBe('blocked');
});

test('allowlisted protocol events keep tool metadata and drop thought frames', () => {
  const events = [
    JSON.stringify({ sessionUpdate: 'agent_thought_chunk', content: { text: 'private' } }),
    JSON.stringify({ type: 'tool.activity', title: 'echo', kind: 'other', status: 'completed' }),
    JSON.stringify({ type: 'session.opened' }),
  ].join('\n');
  expect(parseAllowlistedProtocolEvents(events)).toEqual([
    { kind: 'other', status: 'completed', title: 'echo', type: 'tool.activity' },
    { type: 'session.opened' },
  ]);
  expect(() => parseAllowlistedProtocolEvents('{not-json')).toThrow(/unparseable/);
  expect(() => parseAllowlistedProtocolEvents('{"type":"mystery.event"}')).toThrow(/unknown/);
});

test('diagnostic retention scans every candidate input and fails closed on secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-safe-diag-'));
  const secret = uniqueFixtureSecret();
  const candidates = {
    assistantPreview: `ok ${secret}`,
    eventsText: JSON.stringify({ type: 'tool.activity', title: 'echo', note: secret }),
    extraTexts: [`extra ${secret}`],
    resultText: `{"ok":true,"token":"${secret}"}`,
    stderrText: `err ${secret}`,
    stdoutText: `out ${secret}`,
  };
  for (const [field, value] of Object.entries(candidates)) {
    // oxlint-disable-next-line no-await-in-loop -- each candidate must fail closed independently
    await expect(
      retainSafeLiveDiagnostic(root, `leak-${field}`, {
        assistantPreview: field === 'assistantPreview' ? String(value) : '{"ok":true}',
        cleanup: 'confirmed',
        durationMs: 1,
        eventsText: field === 'eventsText' ? String(value) : '{"type":"session.opened"}',
        extraTexts: field === 'extraTexts' ? [String(value)] : [],
        fault: 'none',
        phase: 'invocation',
        resultText: field === 'resultText' ? String(value) : '{"ok":true}',
        secrets: [secret],
        serverAuditObserved: false,
        stderrText: field === 'stderrText' ? String(value) : '',
        stdoutText: field === 'stdoutText' ? String(value) : '',
      }),
    ).rejects.toThrow(/secret/i);
  }
  await expect(stat(join(root, 'leak-stdoutText'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('diagnostic retention keeps a bounded safe summary for normal runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-safe-ok-'));
  const retained = await retainSafeLiveDiagnostic(root, 'grok-acp/invocation', {
    assistantPreview: '{"ok":true,"nonce":"visible-nonce"}',
    cleanup: 'confirmed',
    durationMs: 12,
    eventsText: [
      JSON.stringify({ sessionUpdate: 'agent_thought_chunk', content: { text: 'hidden' } }),
      JSON.stringify({ type: 'tool.activity', title: 'echo', kind: 'other', status: 'completed' }),
    ].join('\n'),
    fault: 'none',
    phase: 'invocation',
    secrets: ['K7mQ2pL9vX4nR8wZ3cF1'],
    serverAuditCorrelationId: 'inv-1',
    serverAuditObserved: true,
    serverAuditToolName: 'echo',
  });
  const diagnostic = JSON.parse(await readFile(join(retained, 'diagnostic.json'), 'utf8')) as {
    readonly assistantPreview: string;
    readonly cleanup: string;
    readonly durationMs: number;
    readonly fault: string;
    readonly phase: string;
    readonly protocolEvents: readonly unknown[];
    readonly serverAudit: { readonly observed: boolean };
  };
  expect(diagnostic.phase).toBe('invocation');
  expect(diagnostic.durationMs).toBe(12);
  expect(diagnostic.fault).toBe('none');
  expect(diagnostic.assistantPreview).toContain('visible-nonce');
  expect(diagnostic.cleanup).toBe('confirmed');
  expect(diagnostic.serverAudit.observed).toBe(true);
  expect(JSON.stringify(diagnostic)).not.toContain('agent_thought_chunk');
  expect(JSON.stringify(diagnostic)).not.toContain('hidden');
  expect((await stat(retained)).mode & 0o777).toBe(0o700);
  expect((await stat(join(retained, 'diagnostic.json'))).mode & 0o777).toBe(0o600);
});

test('diagnostic retention fails closed on symlink escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-safe-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'revo-safe-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'outside', { mode: 0o600 });
  const escapeLabel = join('..', 'escape');
  await expect(
    retainSafeLiveDiagnostic(root, escapeLabel, {
      cleanup: 'confirmed',
      fault: 'none',
      phase: 'session',
      secrets: [],
      serverAuditObserved: false,
    }),
  ).rejects.toThrow(/escape|path/i);
  await symlink(outside, join(root, 'link-out'));
  await expect(
    retainSafeLiveDiagnostic(join(root, 'link-out'), 'probe', {
      cleanup: 'confirmed',
      fault: 'none',
      phase: 'session',
      secrets: [],
      serverAuditObserved: false,
    }),
  ).rejects.toThrow(/escape|path|symlink/i);
});

test('unexpected REDACTED in semantic preview is an invalid diagnostic run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-safe-redacted-'));
  await expect(
    retainSafeLiveDiagnostic(root, 'invalid-redacted', {
      assistantPreview: '{"ok":true,"nonce":"[REDACTED]"}',
      cleanup: 'confirmed',
      fault: 'none',
      phase: 'invocation',
      secrets: [],
      serverAuditObserved: true,
    }),
  ).rejects.toThrow(/REDACTED/);
});

test('readFixtureServerAudit correlates only the requested invocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'revo-audit-read-'));
  const audit = join(root, 'audit.ndjson');
  await writeFile(
    audit,
    `${JSON.stringify({
      correlationId: 'inv-1',
      method: 'tools/call',
      name: 'echo',
      text: 'Nq8vL2mR7wK4pX9cZ1aB',
    })}\n`,
    { mode: 0o600 },
  );
  const records = await readFixtureServerAudit(audit);
  expect(records).toEqual([
    {
      correlationId: 'inv-1',
      method: 'tools/call',
      name: 'echo',
      text: 'Nq8vL2mR7wK4pX9cZ1aB',
    },
  ]);
});
