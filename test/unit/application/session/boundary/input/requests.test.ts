import { describe, expect, test, vi } from 'vitest';

import { decodeOpenAgentSession } from '../../../../../../src/application/session/boundary/input/open.js';
import { decodeRespondAgentSessionRequest } from '../../../../../../src/application/session/boundary/input/response.js';
import { decodeResumeAgentSession } from '../../../../../../src/application/session/boundary/input/resume.js';
import { decodeSendAgentSessionInput } from '../../../../../../src/application/session/boundary/input/send.js';
import { resolveAgentSessionLimits } from '../../../../../../src/application/session/policy/limits/resolve.js';
import { AgentManagerError } from '../../../../../../src/contracts/manager.js';

const limits = resolveAgentSessionLimits(undefined);

const openRequest = () => ({
  agent: { id: 'codex-acp', version: '1.7.0' },
  configuration: { catalogRevision: 'revision', selections: { model: 'provider/model' } },
  limits: { maxPromptBytes: 128 },
  metadata: { project: 'runtime' },
  output: { directory: '/output' },
  parameters: { model: 'provider/model' },
  permissions: { write: true },
  sessionId: 'dlg_01',
  workspace: { directory: '/workspace' },
});

describe('session request boundaries', () => {
  test('owns and freezes a fresh-open request with resolved limits', () => {
    const input = openRequest();
    const decoded = decodeOpenAgentSession(input);
    input.parameters.model = 'changed';

    expect(decoded.parameters).toEqual({ model: 'provider/model' });
    expect(resolveAgentSessionLimits(decoded.limits).maxPromptBytes).toBe(128);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.parameters)).toBe(true);
  });

  test('does not invoke a top-level request getter', () => {
    const getter = vi.fn(() => 'dlg_01');
    const input = Object.defineProperty(openRequest(), 'sessionId', {
      enumerable: true,
      get: getter,
    });

    expect(() => decodeOpenAgentSession(input)).toThrow(AgentManagerError);
    expect(getter).not.toHaveBeenCalled();
  });

  test('accepts configuration selections without an optional revision', () => {
    const decoded = decodeOpenAgentSession({
      ...openRequest(),
      configuration: { selections: { safe: true } },
    });

    expect(decoded.configuration).toEqual({ selections: { safe: true } });
  });

  test.each([
    () => ({ ...openRequest(), extra: true }),
    () => ({ ...openRequest(), workspace: {} }),
    () => ({ ...openRequest(), parameters: { invalid: new Date() } }),
    () => ({ ...openRequest(), output: { directory: '' } }),
    () => ({ ...openRequest(), metadata: [] }),
    () => ({ ...openRequest(), configuration: {} }),
    () => ({ ...openRequest(), configuration: { selections: { invalid: 1 } } }),
    () => ({ ...openRequest(), configuration: { selections: { '': true } } }),
    () => ({ ...openRequest(), configuration: { selections: { model: 'x'.repeat(4_097) } } }),
    () => ({ ...openRequest(), configuration: { catalogRevision: '', selections: {} } }),
    () => ({
      ...openRequest(),
      configuration: {
        selections: Object.fromEntries(
          Array.from({ length: 129 }, (_, index) => [`option-${index}`, true]),
        ),
      },
    }),
  ])('rejects malformed fresh-open input', (input) => {
    expect(() => decodeOpenAgentSession(input())).toThrow(AgentManagerError);
  });

  test('owns send metadata and enforces the effective prompt limit', () => {
    const metadata = { source: 'user' };
    const decoded = decodeSendAgentSessionInput(
      { metadata, prompt: 'continue', turnId: 'trn_01' },
      { ...limits, maxPromptBytes: 8 },
    );
    metadata.source = 'changed';

    expect(decoded.metadata).toEqual({ source: 'user' });
    expect(Object.isFrozen(decoded.metadata)).toBe(true);
    expect(() =>
      decodeSendAgentSessionInput(
        { prompt: '123456789', turnId: 'trn_02' },
        { ...limits, maxPromptBytes: 8 },
      ),
    ).toThrow(AgentManagerError);
  });

  test.each([
    { prompt: '', turnId: 'trn' },
    { prompt: 'ok', turnId: '' },
    { metadata: [], prompt: 'ok', turnId: 'trn' },
    { metadata: { invalid: new Date() }, prompt: 'ok', turnId: 'trn' },
    { extra: true, prompt: 'ok', turnId: 'trn' },
  ])('rejects malformed turn input %#', (input) => {
    expect(() => decodeSendAgentSessionInput(input, limits)).toThrow(AgentManagerError);
  });

  test('owns explicit resume launch input without accepting identity overrides', () => {
    const input = {
      output: { directory: '/output/resumed' },
      parameters: {},
      permissions: {},
      token: {
        cursor: { eventId: 'evt_10', sequence: 10, streamId: 'stream_01' },
        eligibility: 'hibernated',
        payload: 'payload',
        pin: { agentId: 'codex-acp', agentVersion: '1.7.0', definitionDigest: 'digest' },
        resumeTokenId: 'tok_01',
        schemaVersion: 'agent-session-resume-token/v1',
        sessionId: 'dlg_01',
        sha256: 'sha256',
      },
      workspace: { directory: '/workspace' },
    };
    const decoded = decodeResumeAgentSession(input);
    input.token.sessionId = 'changed';

    expect(decoded.token.sessionId).toBe('dlg_01');
    expect(Object.isFrozen(decoded.token)).toBe(true);
    expect(() => decodeResumeAgentSession({ ...input, sessionId: 'override' })).toThrow(
      AgentManagerError,
    );
    expect(() =>
      decodeResumeAgentSession({
        ...input,
        agent: { id: 'codex-acp', version: '1.7.0' },
      }),
    ).toThrow(AgentManagerError);
  });

  test('accepts and owns a structured multi-answer response', () => {
    const values = { areas: ['tests', 'docs'], retry: 2, safe: true };
    const decoded = decodeRespondAgentSessionRequest(
      { requestId: 'req_01', response: { kind: 'input', outcome: 'submitted', values } },
      limits,
    );
    values.areas[0] = 'changed';

    expect(decoded.response).toEqual({
      kind: 'input',
      outcome: 'submitted',
      values: { areas: ['tests', 'docs'], retry: 2, safe: true },
    });
    expect(Object.isFrozen(decoded.response)).toBe(true);
  });

  test.each([
    { requestId: 'req_01', response: { kind: 'permission', outcome: 'selected' } },
    {
      requestId: 'req_01',
      response: { kind: 'permission', optionId: 'allow', outcome: 'unknown' },
    },
    {
      requestId: 'req_01',
      response: { kind: 'input', outcome: 'submitted', values: { date: new Date() } },
    },
    { requestId: 'req_01', response: { kind: 'input', outcome: 'declined', values: {} } },
  ])('rejects malformed interaction response %#', (input) => {
    expect(() => decodeRespondAgentSessionRequest(input, limits)).toThrow(AgentManagerError);
  });

  test.each([
    { kind: 'permission', optionId: 'allow', outcome: 'selected' },
    { kind: 'permission', outcome: 'denied' },
    { kind: 'input', outcome: 'declined' },
    { kind: 'input', outcome: 'cancelled' },
  ])('accepts closed interaction response %#', (response) => {
    expect(
      decodeRespondAgentSessionRequest({ requestId: 'req_02', response }, limits).response,
    ).toEqual(response);
  });

  test.each([
    null,
    { requestId: '', response: { kind: 'input', outcome: 'declined' } },
    { requestId: 'req', response: null },
    { requestId: 'req', response: { kind: 'permission', optionId: '', outcome: 'selected' } },
    { requestId: 'req', response: { extra: true, kind: 'permission', outcome: 'denied' } },
    { requestId: 'req', response: { kind: 'input', outcome: 'submitted', values: [] } },
    { requestId: 'req', response: { kind: 'input', outcome: 'submitted', values: { answer: {} } } },
    {
      requestId: 'req',
      response: { kind: 'input', outcome: 'submitted', values: { selection: ['ok', 1] } },
    },
    { requestId: 'req', response: { extra: true, kind: 'input', outcome: 'cancelled' } },
    { requestId: 'req', response: { kind: 'unknown', outcome: 'unknown' } },
    { extra: true, requestId: 'req', response: { kind: 'input', outcome: 'declined' } },
  ])('rejects another invalid interaction shape %#', (input) => {
    expect(() => decodeRespondAgentSessionRequest(input, limits)).toThrow(AgentManagerError);
  });

  test('does not invoke resume accessors', () => {
    const getter = vi.fn(() => ({}));
    const input = Object.defineProperty(
      {
        output: { directory: '/output' },
        parameters: {},
        permissions: {},
        workspace: { directory: '/workspace' },
      },
      'token',
      { enumerable: true, get: getter },
    );

    expect(() => decodeResumeAgentSession(input)).toThrow(AgentManagerError);
    expect(getter).not.toHaveBeenCalled();
  });
});
