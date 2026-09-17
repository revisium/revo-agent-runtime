const TYPES = Object.freeze(['api', 'oauth', 'wellknown'] as const);
const COMPETING = Object.freeze(['OPENCODE_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY']);

export type OpenCodeAuthStatus = Readonly<{
  cachedLogin: 'absent' | 'present' | 'unproven';
  ready: boolean;
  reason: string;
  source: string;
}>;

const ansiEscape = String.fromCharCode(27);
const stripAnsi = (text: string): string =>
  text.replaceAll(new RegExp(`${ansiEscape}\\[[0-9;]*m`, 'g'), '');

const present = (
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> | undefined,
  name: string,
): boolean => {
  const value = env?.[name];
  return value !== undefined && value !== '';
};

const authFailure = (text: string): boolean =>
  /\b(?:unauthori[sz]ed|unauthenticated|authentication (?:required|failed)|not (?:logged|signed) in|please log in|login required|\b401\b|\b403\b)\b/i.test(
    text,
  );

const normalizedProvider = (name: string): string =>
  name.replaceAll(/[^a-z0-9]+/gi, '').toLowerCase();

const closed = (
  cachedLogin: OpenCodeAuthStatus['cachedLogin'],
  reason: string,
): OpenCodeAuthStatus =>
  Object.freeze({
    cachedLogin,
    ready: false,
    reason,
    source: 'none',
  });

export const evaluateOpenCodeAuthList = ({
  stdout,
  stderr,
  exitCode,
  error,
  env,
  provider = 'xai',
}: {
  readonly provider?: string;
  readonly env?: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
  readonly error?: Error;
  readonly exitCode?: number | null;
  readonly stderr?: string;
  readonly stdout?: string;
}): OpenCodeAuthStatus => {
  if (COMPETING.some((name) => present(env, name))) return closed('unproven', 'competing');
  const combined = `${stdout ?? ''}\n${stderr ?? ''}\n${error?.message ?? ''}`;
  if (error !== undefined || exitCode !== 0 || authFailure(combined))
    return closed('absent', 'error');
  const text = stripAnsi(combined);
  if (text.trim().length === 0) return closed('unproven', 'empty');
  if (/\bEnvironment\b/.test(text)) return closed('unproven', 'competing');
  const outro = text.match(/(\d+)\s+credentials/i);
  if (outro === null) return closed('unproven', 'unknown');
  const count = Number(outro[1]);
  const credentialLines: { readonly name: string; readonly type: string }[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^[┌│└●◆\s]+/, '').trim();
    if (line.length === 0 || /^Credentials\b/i.test(line) || /\d+\s+credentials/i.test(line))
      continue;
    const match = line.match(/^(.*)\s+(api|oauth|wellknown)$/i);
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      credentialLines.push({ name: match[1].trim(), type: match[2].toLowerCase() });
      continue;
    }
    const tokens = line.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length >= 2) return closed('unproven', 'unknown');
  }
  if (count === 0) return closed('absent', 'header-only');
  if (credentialLines.length !== count) return closed('unproven', 'unknown');
  const providerId = normalizedProvider(provider);
  if (!['xai', 'openai', 'anthropic', 'google', 'githubcopilot'].includes(providerId))
    return closed('unproven', 'unsupported-provider');
  const selected = credentialLines.filter((entry) => normalizedProvider(entry.name) === providerId);
  if (selected.length === 0) return closed('absent', 'missing-selected');
  if (selected.length > 1) return closed('unproven', 'ambiguous');
  const type = selected[0]?.type;
  if (type === undefined || !TYPES.some((allowed) => allowed === type))
    return closed('unproven', 'unknown');
  return Object.freeze({
    cachedLogin: 'present',
    ready: true,
    reason: `selected-${providerId}`,
    source: `${providerId}-${type}`,
  });
};
