import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';

import { evaluateOpenCodeAuthList } from './opencode-auth-status.js';

const require = createRequire(import.meta.url);
const cjs = require('node:child_process') as typeof childProcess;
const competing = Object.freeze(['OPENCODE_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY']);

const present = (env: NodeJS.ProcessEnv | undefined, name: string): 'absent' | 'present' => {
  const value = env?.[name];
  return value === undefined || value === '' ? 'absent' : 'present';
};

const isOpenCodeAcp = (command: unknown, args: readonly string[]): boolean =>
  basename(typeof command === 'string' ? command : '') === 'opencode' && args.includes('acp');

const envRecord = (value: unknown): NodeJS.ProcessEnv | undefined =>
  value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? (value as NodeJS.ProcessEnv)
    : undefined;

export const installOpenCodeSpawnPreflight = (
  options: { readonly recordPath?: string } = {},
): (() => void) => {
  const originalSpawn = cjs.spawn;
  const originalSpawnSync = cjs.spawnSync;
  const recordPath = options.recordPath ?? process.env.REVO_SPAWN_PREFLIGHT_RECORD;

  const writeRecord = (record: Readonly<Record<string, unknown>>): void => {
    if (recordPath === undefined || recordPath.length === 0) return;
    appendFileSync(recordPath, `${JSON.stringify(record)}\n`);
  };

  const runExactContextPreflight = (command: string, spawnOptions: unknown): boolean => {
    const optionsRecord =
      spawnOptions !== undefined && typeof spawnOptions === 'object' && !Array.isArray(spawnOptions)
        ? (spawnOptions as { cwd?: unknown; env?: unknown })
        : undefined;
    const cwd = typeof optionsRecord?.cwd === 'string' ? optionsRecord.cwd : '';
    const env = envRecord(optionsRecord?.env);
    if (cwd.length === 0 || env === undefined) {
      writeRecord({ cachedLogin: 'unproven', cwd, ready: false, reason: 'missing-context' });
      return false;
    }
    const status = originalSpawnSync(command, ['auth', 'list'], {
      cwd,
      encoding: 'utf8',
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
    });
    const verdict = evaluateOpenCodeAuthList({
      env,
      exitCode: status.status,
      stderr: status.stderr,
      stdout: status.stdout,
      ...(status.error === undefined ? {} : { error: status.error }),
    });
    console.log(
      [
        'preflight=opencode-acp-spawn',
        `cwd=${cwd}`,
        `home=${present(env, 'HOME')}`,
        `path=${present(env, 'PATH')}`,
        `configContent=${present(env, 'OPENCODE_CONFIG_CONTENT')}`,
        `printLogs=${present(env, 'OPENCODE_PRINT_LOGS')}`,
        `competing=${competing.map((name) => `${name}=${present(env, name)}`).join(',')}`,
        `authListExit=${status.status ?? 1}`,
        `cached-login=${verdict.cachedLogin}`,
        `source=${verdict.source}`,
        `reason=${verdict.reason}`,
        `ready=${verdict.ready ? 'yes' : 'no'}`,
      ].join('; '),
    );
    writeRecord({
      cachedLogin: verdict.cachedLogin,
      configContent: present(env, 'OPENCODE_CONFIG_CONTENT'),
      cwd,
      loginStatusExit: status.status ?? 1,
      ready: verdict.ready,
      reason: verdict.reason,
      source: verdict.source,
    });
    return verdict.ready;
  };

  const interceptedSpawn = ((
    ...spawnArgs: Parameters<typeof childProcess.spawn>
  ): ReturnType<typeof childProcess.spawn> => {
    const [command, args, spawnOptions] = spawnArgs;
    const argv = Array.isArray(args) ? args.map(String) : [];
    const opts = (Array.isArray(args) ? spawnOptions : args) ?? {};
    if (typeof command === 'string' && isOpenCodeAcp(command, argv)) {
      writeRecord({
        argsKind: Array.isArray(args) ? 'array' : typeof args,
        command,
        forwardedArgs: argv,
        cwd:
          typeof opts === 'object' && opts !== null && 'cwd' in opts && typeof opts.cwd === 'string'
            ? opts.cwd
            : '',
        optionsKeys: opts === undefined || opts === null ? [] : Object.keys(opts),
        sameArgsRef: true,
        sameCommandRef: true,
        sameOptionsRef: true,
        stage: 'before-forward',
      });
      if (!runExactContextPreflight(command, opts)) {
        throw new Error('opencode exact-context auth preflight failed');
      }
    }
    return originalSpawn(...spawnArgs);
  }) as typeof childProcess.spawn;

  cjs.spawn = interceptedSpawn;
  childProcess.spawn = interceptedSpawn;
  syncBuiltinESMExports();

  return () => {
    cjs.spawn = originalSpawn;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  };
};
