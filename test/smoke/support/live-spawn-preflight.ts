import childProcess from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';

import { evaluateOpenCodeAuthList } from './opencode-auth-status.js';
import { verifiedPublicOpenCodeModel } from './opencode-public-model.js';

type ContextProvider = 'codex' | 'claude' | 'grok' | 'opencode';
let openCodeProvider = 'xai';
let openCodeModel = '';
let installed = false;

export const requireLiveSpawnPreflight = (): void => {
  if (!installed) throw new Error('Live context requires context-live.ts spawn preflight launcher');
};

/** Bind readiness to the actual model selection before creating its process. */
export const selectOpenCodePreflightProvider = (model: unknown): void => {
  if (typeof model !== 'string' || !model.includes('/'))
    throw new Error('OpenCode model provider is unproven');
  openCodeProvider = model.split('/')[0] ?? '';
  openCodeModel = model;
};

const positiveGrokCache = (env: NodeJS.ProcessEnv): boolean => {
  try {
    const root = env.GROK_HOME ?? (env.HOME === undefined ? undefined : join(env.HOME, '.grok'));
    if (root === undefined) return false;
    const cache: unknown = JSON.parse(readFileSync(join(root, 'auth.json'), 'utf8'));
    if (typeof cache !== 'object' || cache === null || Array.isArray(cache)) return false;
    const entries: unknown[] = Object.values(cache);
    return entries.some((entry) => {
      if (typeof entry !== 'object' || entry === null || !('key' in entry)) return false;
      return (
        typeof entry.key === 'string' &&
        entry.key.length > 0 &&
        'auth_mode' in entry &&
        (entry.auth_mode === 'oidc' || entry.auth_mode === 'oauth')
      );
    });
  } catch {
    return false;
  }
};

const loggedInClaude = (stdout: string): boolean => {
  try {
    const status: unknown = JSON.parse(stdout);
    return (
      typeof status === 'object' &&
      status !== null &&
      'loggedIn' in status &&
      status.loggedIn === true &&
      'authMethod' in status &&
      status.authMethod === 'claude.ai'
    );
  } catch {
    return false;
  }
};

const canonicalIdentity = (executable: string | undefined): string | undefined => {
  try {
    return executable === undefined ? undefined : realpathSync(executable);
  } catch {
    return undefined;
  }
};

/** Test-only guard: status output stays in memory; the original spawn tuple is forwarded. */
export const installLiveSpawnPreflight = (options: {
  readonly provider: ContextProvider;
  readonly executable: string;
}): (() => void) => {
  if (installed) throw new Error('Live spawn preflight is already installed');
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const expected = realpathSync(options.executable);
  const provider = options.provider;
  const competing = [
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'XAI_API_KEY',
    'GROK_API_KEY',
    'OPENCODE_API_KEY',
  ];
  const isProviderLaunch = (args: readonly string[]): boolean => {
    if (provider === 'codex') return args.some((arg) => basename(arg) === 'codex-acp.mjs');
    if (provider === 'claude') return args.some((arg) => basename(arg) === 'claude-agent-acp.mjs');
    if (provider === 'grok') return args.includes('stdio');
    return args.includes('acp');
  };
  const preflight = (command: string, context: childProcess.SpawnOptions): void => {
    const env = context.env;
    if (
      typeof context.cwd !== 'string' ||
      env === undefined ||
      competing.some((name) => Boolean(env[name]))
    )
      throw new Error(`${provider} exact-context preflight has missing or competing context`);
    const executable =
      provider === 'codex'
        ? env.CODEX_PATH
        : provider === 'claude'
          ? env.CLAUDE_CODE_EXECUTABLE
          : command;
    if (executable === undefined || canonicalIdentity(executable) !== expected)
      throw new Error(`${provider} exact-context CLI identity mismatch`);
    let ready: boolean;
    let source = 'cached-login';
    if (provider === 'grok') ready = positiveGrokCache(env);
    else {
      const probe = (args: string[]) =>
        originalSpawnSync(executable, args, {
          cwd: context.cwd,
          env,
          uid: context.uid,
          gid: context.gid,
          encoding: 'utf8',
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 20_000,
        });
      const args =
        provider === 'codex'
          ? ['login', 'status']
          : provider === 'claude'
            ? ['auth', 'status', '--json']
            : ['auth', 'list'];
      const status = probe(args);
      const stdout = status.stdout ?? '';
      const stderr = status.stderr ?? '';
      const escape = String.fromCharCode(27);
      const cleanStatus = `${stdout}\n${stderr}`
        .replaceAll(new RegExp(`${escape}\\[[0-9;]*m`, 'g'), '')
        .trim();
      ready =
        status.error === undefined &&
        status.status === 0 &&
        (provider === 'codex'
          ? /\bLogged in using ChatGPT\b/i.test(cleanStatus) &&
            !/API key|not logged in/i.test(cleanStatus)
          : provider === 'claude'
            ? loggedInClaude(stdout)
            : evaluateOpenCodeAuthList({
                env,
                exitCode: status.status,
                stdout,
                stderr,
                provider: openCodeProvider,
              }).ready);
      if (provider === 'opencode' && openCodeProvider === 'opencode') {
        const version = probe(['--version']);
        const models = probe(['models', 'opencode', '--verbose']);
        ready =
          version.status === 0 &&
          models.status === 0 &&
          version.error === undefined &&
          models.error === undefined &&
          verifiedPublicOpenCodeModel({
            selectedModel: openCodeModel,
            reportedVersion: (version.stdout ?? '').trim(),
            stdout: models.stdout ?? '',
          });
        source = ready ? 'public-model' : 'unproven';
      }
    }
    console.log(
      `${provider}: spawn-preflight=${ready ? 'ready' : 'blocked'}; source=${source}; ${provider === 'grok' ? 'remote-auth=unproven' : `provider=${provider === 'opencode' ? openCodeProvider : provider}`}`,
    );
    if (!ready) throw new Error(`${provider} exact-context cached-login preflight failed`);
  };
  childProcess.spawn = ((...spawnArgs: Parameters<typeof childProcess.spawn>) => {
    const [command, args, spawnOptions] = spawnArgs;
    const argv = Array.isArray(args) ? args : [];
    const context = ((Array.isArray(args) ? spawnOptions : args) ??
      {}) as childProcess.SpawnOptions;
    if (isProviderLaunch(argv)) preflight(command, context);
    return originalSpawn(...spawnArgs);
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  installed = true;
  return () => {
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
    installed = false;
  };
};
