import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type {
  AgentInvocationResult,
  AgentSession,
  AgentSessionEvent,
  AgentSessionTurnResult,
} from '../../../src/index.js';

export interface LivePathEvidence {
  readonly delivery: string;
  readonly expected: string;
  readonly faultCode?: string;
  readonly faultPhase?: string;
  readonly nonceObserved: boolean;
  readonly permissionRequested?: boolean;
  readonly status: string;
  readonly toolObserved: boolean;
}

export type LivePathVerdict = 'passed' | 'blocked' | 'failed';

export type DeclaredAuthSource = 'cached-login' | 'invocation-env' | 'undeclared';

export interface FixtureServerAuditRecord {
  readonly correlationId: string;
  readonly method: 'tools/call';
  readonly name: 'echo';
  readonly text: string;
}

export interface AllowlistedProtocolEvent {
  readonly type: string;
  readonly title?: string;
  readonly kind?: string;
  readonly status?: string;
}

export interface LiveDiagnosticInput {
  readonly phase: string;
  readonly durationMs?: number;
  readonly fault: string;
  readonly assistantPreview?: string;
  readonly eventsText?: string;
  readonly stdoutText?: string;
  readonly stderrText?: string;
  readonly resultText?: string;
  readonly extraTexts?: readonly string[];
  readonly serverAuditObserved: boolean;
  readonly toolObserverObserved?: boolean;
  readonly serverAuditCorrelationId?: string;
  readonly serverAuditToolName?: string;
  readonly cleanup: string;
  readonly secrets: readonly string[];
}

export const fixtureOutputNames = Object.freeze([
  'events.ndjson',
  'stdout.log',
  'stderr.log',
  'result.json',
  'raw-final-response.txt',
] as const);

const THOUGHT_MARKERS = Object.freeze(['agent_thought_chunk']);
const ALLOWLISTED_EVENT_TYPES = Object.freeze([
  'session.opened',
  'session.closed',
  'turn.started',
  'turn.completed',
  'tool.activity',
  'interaction.requested',
  'interaction.resolved',
  'invocation.accepted',
  'invocation.started',
  'invocation.cancelling',
  'invocation.finished',
]);
const DROPPED_EVENT_TYPES = Object.freeze([
  'assistant.message.delta',
  'assistant.message.completed',
  'agent.progress',
  'plan.updated',
  'usage.updated',
  'session.accepted',
  'session.checkpointed',
  'session.hibernated',
]);

export const uniqueFixtureSecret = (): string => randomBytes(16).toString('hex');

export const declaredAuthSource = (value: string | undefined): DeclaredAuthSource => {
  if (value === 'cached-login' || value === 'invocation-env') return value;
  return 'undeclared';
};

export const combinedInstructions = (instructionNonce: string): string =>
  `Prefer terse answers. Instruction nonce: ${instructionNonce}. Repeat this instruction nonce when asked.`;

export const combinedInvocationPrompt = (): string =>
  'You must call the knowledge MCP echo tool with the instruction nonce from your instructions. After it returns, reply with only this JSON object and no other text: {"ok":true,"nonce":"<instruction nonce>"}';

export const jsonOnlyInvocationPrompt = (): string =>
  'Reply with only this JSON object and no other text: {"ok":true,"nonce":"<instruction nonce>"}';

export const mcpOnlySessionPrompt = (): string =>
  'You must call the knowledge MCP echo tool with the instruction nonce from your instructions. Then reply with exactly that instruction nonce.';

export const invocationResultSchema = Object.freeze({
  additionalProperties: false,
  properties: {
    nonce: { minLength: 1, type: 'string' },
    ok: { const: true, type: 'boolean' },
  },
  required: ['ok', 'nonce'],
  type: 'object',
});

export const uniqueSessionId = (definitionId: string, runNonce: string): string =>
  `dlg_${definitionId.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}_context_${runNonce}`;

export const knowledgeMcpLaunchArgs = (
  scriptPath: string,
  auditPath: string,
  correlationId: string,
): readonly string[] => [scriptPath, `--audit=${auditPath}`, `--correlation=${correlationId}`];

export const textShowsNonce = (text: string, token: string): boolean =>
  token.length > 0 && text.includes(token);

export const textShowsMcpTool = (text: string, token: string): boolean =>
  token.length > 0 && text.includes(`echo:${token}`);

export const sessionObserverSawTool = (events: readonly AgentSessionEvent[]): boolean =>
  events.some((event) => event.type === 'tool.activity');

export const permissionRequested = (events: readonly AgentSessionEvent[]): boolean =>
  events.some(
    (event) => event.type === 'interaction.requested' && event.request.kind === 'permission',
  );

export const invocationNonceObserved = (
  result: AgentInvocationResult,
  outputs: string,
  token: string,
): boolean => {
  if (result.status === 'succeeded' && JSON.stringify(result.value).includes(token)) return true;
  return textShowsNonce(outputs, token);
};

export const semanticResultRedacted = (result: AgentInvocationResult): boolean =>
  result.status === 'succeeded' && JSON.stringify(result.value).includes('[REDACTED]');

export const summarizeInvocationFault = (result: AgentInvocationResult): string => {
  if (result.status === 'succeeded') return 'none';
  return `${result.error.code}/${result.error.phase}`;
};

export const summarizeInvocationDiagnostics = (result: AgentInvocationResult): string => {
  const preview =
    result.status === 'failed' && result.rawResponse !== undefined
      ? result.rawResponse.preview.slice(0, 1_024)
      : undefined;
  return [
    `durationMs=${result.durationMs}`,
    `fault=${summarizeInvocationFault(result)}`,
    preview === undefined ? 'preview=none' : `preview=${JSON.stringify(preview)}`,
  ].join('; ');
};

export const summarizeSessionDiagnostics = (
  result: AgentSessionTurnResult,
  terminal?: string,
): string => {
  const fault =
    result.status === 'failed' || result.status === 'timed_out'
      ? result.error === undefined
        ? result.status
        : `${result.error.code}/${result.error.phase}`
      : 'none';
  return `status=${result.status}; fault=${fault}; terminal=${terminal ?? 'unknown'}`;
};

export const assertLivePath = (
  path: 'invocation' | 'session',
  evidence: LivePathEvidence,
): void => {
  const problems: string[] = [];
  if (evidence.delivery !== evidence.expected)
    problems.push(`delivery ${evidence.delivery} != ${evidence.expected}`);
  if (!evidence.nonceObserved) problems.push('nonce missing');
  if (!evidence.toolObserved) problems.push('mcp tool missing');
  if (path === 'invocation' && evidence.status !== 'succeeded')
    problems.push(
      `status ${evidence.status}${evidence.faultCode === undefined ? '' : ` ${evidence.faultCode}`}`,
    );
  if (path === 'session' && evidence.status !== 'completed')
    problems.push(`status ${evidence.status}`);
  if (problems.length > 0) throw new Error(`${path} acceptance failed: ${problems.join('; ')}`);
};

export const livePathVerdict = (
  path: 'invocation' | 'session',
  evidence: LivePathEvidence,
): LivePathVerdict => {
  if (evidence.permissionRequested === true) return 'blocked';
  try {
    assertLivePath(path, evidence);
    return 'passed';
  } catch {
    return 'failed';
  }
};

export const authSourceLine = (
  name: string,
  inherit: readonly string[],
  catalogModels: number,
  source: DeclaredAuthSource,
): string =>
  [
    `${name}: authSource=${source}`,
    `inherit=${inherit.join(',') || 'none'}`,
    'inspectConfiguration=same-context',
    `catalogModels=${catalogModels}`,
    'catalog=capability-not-auth',
  ].join('; ');

export const answerFixtureEchoPermissions = async (
  session: Pick<AgentSession, 'respond'>,
  events: readonly AgentSessionEvent[],
  answered: Set<string>,
): Promise<void> => {
  for (const event of events) {
    if (event.type !== 'interaction.requested' || event.request.kind !== 'permission') continue;
    if (answered.has(event.request.requestId)) continue;
    answered.add(event.request.requestId);
    const request = event.request;
    const rejection = request.options.find(
      (option) => option.kind === 'reject_once' || option.kind === 'reject_always',
    );
    if (rejection !== undefined) {
      // oxlint-disable-next-line no-await-in-loop -- permission answers must stay ordered per request
      await session.respond({
        requestId: request.requestId,
        response: { kind: 'permission', optionId: rejection.optionId, outcome: 'selected' },
      });
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- permission answers must stay ordered per request
    await session.respond({
      requestId: request.requestId,
      response: { kind: 'permission', outcome: 'denied' },
    });
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAuditRecord = (value: unknown): value is FixtureServerAuditRecord =>
  isRecord(value) &&
  typeof value.correlationId === 'string' &&
  value.method === 'tools/call' &&
  value.name === 'echo' &&
  typeof value.text === 'string';

export const readFixtureServerAudit = async (
  auditPath: string,
): Promise<readonly FixtureServerAuditRecord[]> => {
  let text: string;
  try {
    text = await readFile(auditPath, 'utf8');
  } catch {
    return [];
  }
  const records: FixtureServerAuditRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('unparseable fixture audit');
    }
    if (!isAuditRecord(parsed)) throw new Error('unknown fixture audit');
    records.push(parsed);
  }
  return records;
};

const isFixtureEchoTitle = (title: unknown): boolean =>
  title === 'echo' ||
  title === 'mcp.knowledge.echo' ||
  title === 'knowledge_echo' ||
  title === 'knowledge__echo' ||
  title === 'mcp__knowledge__echo';

const recordHasEchoToolFrame = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.type === 'tool.activity' && isFixtureEchoTitle(value.title)) return true;
  if (
    (value.sessionUpdate === 'tool_call' || value.sessionUpdate === 'tool_call_update') &&
    isFixtureEchoTitle(value.title)
  )
    return true;
  return recordHasEchoToolFrame(value.params) || recordHasEchoToolFrame(value.update);
};

const outputsHaveEchoToolFrame = (outputs: string): boolean => {
  for (const line of outputs.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      if (recordHasEchoToolFrame(JSON.parse(trimmed))) return true;
    } catch {
      continue;
    }
  }
  return false;
};

export const fixtureMcpEvidence = (input: {
  readonly audit: readonly FixtureServerAuditRecord[];
  readonly correlationId: string;
  readonly events: readonly AgentSessionEvent[];
  readonly nonce: string;
  readonly outputs: string;
}): boolean => {
  return (
    fixtureServerAuditObserved(input.audit, input.correlationId, input.nonce) &&
    fixtureToolObserverObserved(input.events, input.outputs)
  );
};

export const fixtureServerAuditObserved = (
  audit: readonly FixtureServerAuditRecord[],
  correlationId: string,
  nonce: string,
): boolean =>
  nonce.length > 0 &&
  audit.some(
    (record) =>
      record.correlationId === correlationId &&
      record.method === 'tools/call' &&
      record.name === 'echo' &&
      record.text === nonce,
  );

export const fixtureToolObserverObserved = (
  events: readonly AgentSessionEvent[],
  outputs: string,
): boolean =>
  events.some((event) => event.type === 'tool.activity' && isFixtureEchoTitle(event.title)) ||
  outputsHaveEchoToolFrame(outputs);

const allowlistedEvent = (
  record: Record<string, unknown>,
): AllowlistedProtocolEvent | undefined => {
  const type = typeof record.type === 'string' ? record.type : undefined;
  const sessionUpdate = typeof record.sessionUpdate === 'string' ? record.sessionUpdate : undefined;
  const resolved = type ?? sessionUpdate;
  if (resolved === undefined) throw new Error('unknown protocol event');
  if (THOUGHT_MARKERS.some((marker) => resolved.includes(marker))) return undefined;
  if (DROPPED_EVENT_TYPES.some((dropped) => dropped === resolved)) return undefined;
  if (!ALLOWLISTED_EVENT_TYPES.some((allowed) => allowed === resolved))
    throw new Error('unknown protocol event');
  return {
    type: resolved,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.kind === 'string' ? { kind: record.kind } : {}),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
  };
};

export const parseAllowlistedProtocolEvents = (
  text: string,
): readonly AllowlistedProtocolEvent[] => {
  if (text.trim() === '') return [];
  const events: AllowlistedProtocolEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('unparseable protocol event');
    }
    if (!isRecord(parsed)) throw new Error('unparseable protocol event');
    const event = allowlistedEvent(parsed);
    if (event !== undefined) events.push(event);
  }
  return events;
};

const evidenceLabel = (label: string): string => {
  const safe = label.replaceAll(/[^a-zA-Z0-9._-]+/g, '_');
  if (safe.length === 0 || safe.includes('..')) throw new Error('path escape');
  return safe;
};

const candidateTexts = (input: LiveDiagnosticInput): readonly string[] => [
  input.phase,
  input.fault,
  input.cleanup,
  input.assistantPreview ?? '',
  input.eventsText ?? '',
  input.stdoutText ?? '',
  input.stderrText ?? '',
  input.resultText ?? '',
  ...(input.extraTexts ?? []),
  input.serverAuditCorrelationId ?? '',
  input.serverAuditToolName ?? '',
];

const containsSecret = (text: string, secrets: readonly string[]): boolean =>
  secrets.some((secret) => secret.length > 0 && text.includes(secret));

export const retainSafeLiveDiagnostic = async (
  destinationRoot: string,
  label: string,
  input: LiveDiagnosticInput,
): Promise<string> => {
  const safeLabel = evidenceLabel(label);
  const existing = await lstat(destinationRoot).catch(() => undefined);
  if (existing?.isSymbolicLink()) throw new Error('symlink destination');
  await mkdir(destinationRoot, { mode: 0o700, recursive: true });
  await chmod(destinationRoot, 0o700);
  if ((await lstat(destinationRoot)).isSymbolicLink()) throw new Error('symlink destination');
  const resolvedRoot = await realpath(destinationRoot);
  const directory = join(resolvedRoot, safeLabel);
  if (directory !== resolvedRoot && !directory.startsWith(`${resolvedRoot}${sep}`))
    throw new Error('path escape');
  for (const candidate of candidateTexts(input)) {
    if (containsSecret(candidate, input.secrets)) throw new Error('secret detected');
  }
  if ((input.assistantPreview ?? '').includes('[REDACTED]'))
    throw new Error('unexpected REDACTED in semantic preview');
  const protocolEvents = parseAllowlistedProtocolEvents(input.eventsText ?? '');
  const summary = {
    assistantPreview: (input.assistantPreview ?? '').slice(0, 1_024),
    cleanup: input.cleanup,
    durationMs: input.durationMs,
    fault: input.fault,
    phase: input.phase,
    protocolEvents,
    ...(input.toolObserverObserved === undefined
      ? {}
      : { toolObserverObserved: input.toolObserverObserved }),
    serverAudit: {
      observed: input.serverAuditObserved,
      ...(input.serverAuditCorrelationId === undefined
        ? {}
        : { correlationId: input.serverAuditCorrelationId }),
      ...(input.serverAuditToolName === undefined ? {} : { toolName: input.serverAuditToolName }),
    },
  };
  const serialized = `${JSON.stringify(summary)}\n`;
  if (containsSecret(serialized, input.secrets)) throw new Error('secret detected');
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const diagnosticPath = join(directory, 'diagnostic.json');
  await writeFile(diagnosticPath, serialized, { encoding: 'utf8', mode: 0o600 });
  await chmod(diagnosticPath, 0o600);
  return directory;
};

export const retainFixtureOutput = async (
  destinationRoot: string,
  label: string,
  sourceDirectory: string,
  secrets: readonly string[] = [],
): Promise<string> => {
  const sourceStat = await lstat(sourceDirectory).catch(() => undefined);
  if (sourceStat?.isSymbolicLink()) throw new Error('symlink source');
  const texts = await Promise.all(
    fixtureOutputNames.map((name) => readFile(join(sourceDirectory, name), 'utf8').catch(() => '')),
  );
  const byName = Object.fromEntries(
    fixtureOutputNames.map((name, index) => [name, texts[index] ?? '']),
  );
  return retainSafeLiveDiagnostic(destinationRoot, label, {
    assistantPreview: byName['raw-final-response.txt'] || byName['result.json'] || '',
    cleanup: 'confirmed',
    eventsText: byName['events.ndjson'] ?? '',
    fault: 'none',
    phase: label,
    resultText: byName['result.json'] ?? '',
    secrets,
    serverAuditObserved: false,
    stderrText: byName['stderr.log'] ?? '',
    stdoutText: byName['stdout.log'] ?? '',
  });
};
