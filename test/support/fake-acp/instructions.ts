import { readFileSync, statSync } from 'node:fs';

import * as acp from '@agentclientprotocol/sdk';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a Claude-like bridge would read: `_meta.systemPrompt.append` on session creation. */
export const appendedSystemPrompt = (
  params: acp.NewSessionRequest | acp.ResumeSessionRequest,
): string | undefined => {
  const meta: unknown = Reflect.get(params, '_meta');
  const systemPrompt = isRecord(meta) ? meta.systemPrompt : undefined;
  return isRecord(systemPrompt) && typeof systemPrompt.append === 'string'
    ? systemPrompt.append
    : undefined;
};

/** A provider that refuses session creation; the runtime must not retry through another channel. */
export const rejectSessionCreation = (): never => {
  throw acp.RequestError.invalidParams({ error: { message: 'Fixture rejects session creation.' } });
};

/** The echo is JSON so both invocation results and session messages can carry it. */
export const appendedInstructionsEcho = (appended: string | undefined): string =>
  JSON.stringify({ meta: appended ?? null });

const configuredFile = (path: string): Record<string, unknown> => {
  try {
    return {
      content: readFileSync(path, 'utf8'),
      mode: (statSync(path).mode & 0o777).toString(8),
      path,
    };
  } catch {
    return { missing: true, path };
  }
};

/** What OpenCode would do each turn: read every instructions path from its config content. */
export const configuredInstructionsEcho = (): string => {
  const content = process.env.OPENCODE_CONFIG_CONTENT;
  if (content === undefined) return JSON.stringify({ files: null });
  const parsed: unknown = JSON.parse(content);
  const paths = isRecord(parsed) && Array.isArray(parsed.instructions) ? parsed.instructions : [];
  return JSON.stringify({ files: paths.map((path: unknown) => configuredFile(String(path))) });
};
