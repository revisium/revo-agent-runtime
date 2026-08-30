import { mapCodexPermissions } from './codex-permission-strategy.js';

interface CodexArgumentRequest {
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  readonly network: 'disabled' | 'enabled';
  readonly allowDangerFullAccess?: boolean;
  readonly prompt: string;
  readonly model?: string;
  readonly outputSchema?: string;
}

const bounded = (name: string, value: string | undefined, max = 256): string | undefined => {
  if (value === undefined) return undefined;
  if (
    value.length === 0 ||
    value.length > max ||
    value.includes('\u0000') ||
    value.includes('\r') ||
    value.includes('\n')
  )
    throw new Error(`${name} is outside the bounded Codex argument contract.`);
  return value;
};

export const buildCodexExecArguments = (request: CodexArgumentRequest): readonly string[] => {
  const prompt = request.prompt;
  if (prompt.length === 0 || prompt.length > 1_048_576 || prompt.includes('\u0000'))
    throw new Error('Codex prompt is outside the bounded argument contract.');
  const model = bounded('model', request.model);
  const outputSchema = bounded('outputSchema', request.outputSchema, 16_384);
  const permissions = mapCodexPermissions(request);
  const args = [
    '--ask-for-approval=never',
    'exec',
    '--json',
    ...(outputSchema === undefined ? [] : ['--output-schema', outputSchema]),
    permissions.sandboxFlag,
    ...permissions.config,
    ...(model === undefined ? [] : ['--model', model]),
    prompt,
  ];
  return Object.freeze([...args]);
};
