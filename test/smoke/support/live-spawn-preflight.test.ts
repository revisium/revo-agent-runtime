import childProcess from 'node:child_process';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { execa } from 'execa';
import { expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import {
  installLiveSpawnPreflight,
  requireLiveSpawnPreflight,
  selectOpenCodePreflightProvider,
} from './live-spawn-preflight.js';

const unixTest = test.skipIf(process.platform === 'win32');

unixTest('Codex bridge uses exact child context and forwards unchanged through Execa', async () => {
  await withTemporaryDirectory(async (root) => {
    const cli = join(root, 'codex');
    const report = join(root, 'status.json');
    const bridge = join(root, 'codex-acp.mjs');
    await writeFile(
      cli,
      `#!${process.execPath}\nimport('node:fs').then(({writeFileSync}) => {
      writeFileSync(process.env.STATUS_REPORT, JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),home:process.env.HOME}));
      console.log('Logged in using ChatGPT');
    });`,
    );
    await chmod(cli, 0o700);
    await writeFile(bridge, 'console.log("bridge forwarded");');
    const restore = installLiveSpawnPreflight({ provider: 'codex', executable: cli });
    const env = { HOME: root, PATH: '/bin', CODEX_PATH: cli, STATUS_REPORT: report };
    try {
      expect(() => installLiveSpawnPreflight({ provider: 'codex', executable: cli })).toThrow(
        /already installed/,
      );
      const result = await execa(process.execPath, [bridge], { cwd: root, env, extendEnv: false });
      expect(result.stdout).toBe('bridge forwarded');
      expect(JSON.parse(await readFile(report, 'utf8'))).toEqual({
        argv: ['login', 'status'],
        cwd: root,
        home: root,
      });
    } finally {
      restore();
    }
  });
});

unixTest('failed cached-login status blocks spawn without exposing raw diagnostics', async () => {
  await withTemporaryDirectory(async (root) => {
    const cli = join(root, 'codex');
    await writeFile(cli, '#!/bin/sh\necho "not logged in sensitive-account" >&2\nexit 1\n');
    await chmod(cli, 0o700);
    const restore = installLiveSpawnPreflight({ provider: 'codex', executable: cli });
    try {
      expect(() =>
        childProcess.spawn(process.execPath, [join(root, 'codex-acp.mjs')], {
          cwd: root,
          env: { HOME: root, CODEX_PATH: cli, PATH: '/bin' },
        }),
      ).toThrow('codex exact-context cached-login preflight failed');
      expect(() =>
        childProcess.spawn(process.execPath, [join(root, 'codex-acp.mjs')], {
          cwd: root,
          env: { HOME: root, CODEX_PATH: '/unverified/codex', PATH: '/bin' },
        }),
      ).toThrow(/identity/);
    } finally {
      restore();
    }
  });
});

unixTest('Claude cached login must be a Claude account rather than an API-key method', async () => {
  await withTemporaryDirectory(async (root) => {
    const cli = join(root, 'claude');
    const bridge = join(root, 'claude-agent-acp.mjs');
    await writeFile(bridge, 'console.log("claude forwarded");');
    const status = { loggedIn: true, authMethod: 'claude.ai' };
    await writeFile(
      cli,
      `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(status))});`,
    );
    await chmod(cli, 0o700);
    const restore = installLiveSpawnPreflight({ provider: 'claude', executable: cli });
    const context = {
      cwd: root,
      env: { HOME: root, PATH: '/bin', CLAUDE_CODE_EXECUTABLE: cli },
      extendEnv: false,
    };
    try {
      expect((await execa(process.execPath, [bridge], context)).stdout).toBe('claude forwarded');
      await writeFile(
        cli,
        `#!${process.execPath}\nconsole.log('{"loggedIn":true,"authMethod":"api_key"}');`,
      );
      await expect(execa(process.execPath, [bridge], context)).rejects.toThrow(/preflight failed/);
    } finally {
      restore();
    }
    expect(() => requireLiveSpawnPreflight()).toThrow(/launcher/);
  });
});

unixTest('OpenCode spawn verifies the actual selected provider and preserves config', async () => {
  await withTemporaryDirectory(async (root) => {
    const cli = join(root, 'opencode');
    const status = '┌ Credentials cache\n● xAI api\n└ 1 credentials';
    await writeFile(
      cli,
      `#!${process.execPath}\nif(process.argv.includes('auth')) console.log(${JSON.stringify(status)}); else console.log(process.env.OPENCODE_CONFIG_CONTENT);`,
    );
    await chmod(cli, 0o700);
    const restore = installLiveSpawnPreflight({ provider: 'opencode', executable: cli });
    const context = {
      cwd: root,
      env: { HOME: root, PATH: '/bin', OPENCODE_CONFIG_CONTENT: '{"instructions":["private.md"]}' },
      extendEnv: false,
    };
    try {
      selectOpenCodePreflightProvider('xai/selected-model');
      expect((await execa(cli, ['acp'], context)).stdout).toBe(context.env.OPENCODE_CONFIG_CONTENT);
      selectOpenCodePreflightProvider('openai/default-model');
      await expect(execa(cli, ['acp'], context)).rejects.toThrow(/preflight failed/);
    } finally {
      selectOpenCodePreflightProvider('xai/reset');
      restore();
    }
  });
});

unixTest('Grok requires an existing OAuth cache in the exact child home', async () => {
  await withTemporaryDirectory(async (root) => {
    const cli = join(root, 'grok');
    await writeFile(cli, `#!${process.execPath}\nconsole.log('grok forwarded');`);
    await chmod(cli, 0o700);
    await mkdir(join(root, '.grok'));
    const restore = installLiveSpawnPreflight({ provider: 'grok', executable: cli });
    const context = { cwd: root, env: { HOME: root, PATH: '/bin' }, extendEnv: false };
    try {
      await expect(execa(cli, ['agent', 'stdio'], context)).rejects.toThrow(/preflight failed/);
      await writeFile(
        join(root, '.grok', 'auth.json'),
        JSON.stringify({ fixture: { key: 'synthetic-token', auth_mode: 'oidc' } }),
      );
      expect((await execa(cli, ['agent', 'stdio'], context)).stdout).toBe('grok forwarded');
    } finally {
      restore();
    }
  });
});

unixTest('Grok symlink launch cannot bypass cached-login checks', async () => {
  await withTemporaryDirectory(async (root) => {
    const cli = join(root, 'grok');
    const alias = join(root, 'grok-alias');
    await writeFile(cli, '#!/bin/sh\nexit 0\n');
    await chmod(cli, 0o700);
    await symlink(cli, alias);
    const restore = installLiveSpawnPreflight({ provider: 'grok', executable: cli });
    try {
      await expect(
        execa(alias, ['agent', 'stdio'], {
          cwd: root,
          env: { HOME: root, PATH: '/bin' },
          extendEnv: false,
        }),
      ).rejects.toThrow(/preflight failed/);
    } finally {
      restore();
    }
  });
});
