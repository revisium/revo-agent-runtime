import { AgentManagerError, type AgentFault, type AgentProbeResult } from '../../../src/index.js';

const authPattern =
  /\b(?:unauthori[sz]ed|unauthenticated|authentication (?:required|failed)|not (?:logged|signed) in|please log in|login required|refresh OAuth token|cached-login preflight failed|\b401\b|\b403\b)\b/i;

const bounded = (value: string): string => value.slice(0, 160);

const diagnosticText = (fault: AgentFault | undefined): string => {
  const diagnostic = fault?.details?.diagnostic;
  if (diagnostic === undefined) return fault?.message ?? '';
  const parts = [fault?.message ?? ''];
  if (typeof diagnostic.stderr === 'string') parts.push(diagnostic.stderr);
  const provider = diagnostic.provider;
  if (provider !== undefined && typeof provider === 'object' && provider !== null) {
    if ('message' in provider && typeof provider.message === 'string') parts.push(provider.message);
  }
  return parts.join('\n');
};

const isFault = (value: unknown): value is AgentFault =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  'message' in value &&
  'phase' in value &&
  typeof value.code === 'string' &&
  typeof value.message === 'string';

export const isAuthFailure = (error: unknown): boolean => {
  if (isFault(error)) return authPattern.test(diagnosticText(error));
  if (error instanceof AgentManagerError) return authPattern.test(diagnosticText(error.fault));
  if (error instanceof Error) return authPattern.test(error.message);
  return false;
};

export const authFailureCode = (error: unknown): string => {
  if (isFault(error)) return error.code;
  if (error instanceof AgentManagerError) return error.fault.code;
  return 'unknown';
};

export const probePreflightLine = (name: string, probe: AgentProbeResult): string => {
  if (probe.status !== 'available') return `${name}: probe=unavailable; code=${probe.error.code}`;
  const version = probe.reportedVersion === undefined ? 'none' : bounded(probe.reportedVersion);
  return `${name}: probe=available; reportedVersion=${version}`;
};

export const expectedInstructionsChannel = (
  definitionId: string,
  reportedVersion: string | undefined,
):
  | 'acp:session/new._meta.systemPrompt.append'
  | 'opencode:config.instructions-file'
  | 'acp:session/prompt.prefix' => {
  if (definitionId === 'claude-acp') return 'acp:session/new._meta.systemPrompt.append';
  if (
    definitionId === 'opencode-acp' &&
    reportedVersion === '1.18.23' &&
    process.platform !== 'win32'
  )
    return 'opencode:config.instructions-file';
  return 'acp:session/prompt.prefix';
};
