import { expect, test } from 'vitest';

import { evaluateOpenCodeAuthList } from './opencode-auth-status.js';

const headerOnly = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '└  0 credentials',
].join('\n');

const positiveXai = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '●  xAI \u001B[2mapi\u001B[0m',
  '│',
  '└  1 credentials',
].join('\n');

const ambiguousXai = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '●  xAI api',
  '●  xai oauth',
  '│',
  '└  2 credentials',
].join('\n');

const unknownType = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '●  xAI token',
  '│',
  '└  1 credentials',
].join('\n');

const otherProvider = [
  '┌  Credentials ~/.local/share/opencode/auth.json',
  '│',
  '●  OpenAI oauth',
  '│',
  '└  1 credentials',
].join('\n');

const environmentCompeting = [
  positiveXai,
  '',
  '┌  Environment',
  '│',
  '●  xAI XAI_API_KEY',
  '│',
  '└  1 environment variable',
].join('\n');

test('positive selected xai cached credential is ready', () => {
  expect(
    evaluateOpenCodeAuthList({
      env: { HOME: '/tmp/home', PATH: '/bin' },
      exitCode: 0,
      stderr: '',
      stdout: positiveXai,
    }),
  ).toEqual({
    cachedLogin: 'present',
    ready: true,
    reason: 'selected-xai',
    source: 'xai-api',
  });
});

test('zero credentials and header-only auth list are not ready', () => {
  expect(
    evaluateOpenCodeAuthList({ env: {}, exitCode: 0, stderr: '', stdout: headerOnly }),
  ).toMatchObject({ cachedLogin: 'absent', ready: false, reason: 'header-only' });
  expect(evaluateOpenCodeAuthList({ env: {}, exitCode: 0, stderr: '', stdout: '' })).toMatchObject({
    cachedLogin: 'unproven',
    ready: false,
    reason: 'empty',
  });
});

test('error, unknown type, and ambiguous xai status fail closed', () => {
  expect(
    evaluateOpenCodeAuthList({
      env: {},
      exitCode: 1,
      stderr: 'authentication failed',
      stdout: '',
    }),
  ).toMatchObject({ cachedLogin: 'absent', ready: false, reason: 'error' });
  expect(
    evaluateOpenCodeAuthList({ env: {}, exitCode: 0, stderr: '', stdout: unknownType }),
  ).toMatchObject({ ready: false, reason: 'unknown' });
  expect(
    evaluateOpenCodeAuthList({ env: {}, exitCode: 0, stderr: '', stdout: ambiguousXai }),
  ).toMatchObject({ ready: false, reason: 'ambiguous' });
  expect(
    evaluateOpenCodeAuthList({ env: {}, exitCode: 0, stderr: '', stdout: otherProvider }),
  ).toMatchObject({ ready: false, reason: 'missing-selected' });
});

test('competing environment sources fail closed even with a positive xai credential', () => {
  expect(
    evaluateOpenCodeAuthList({
      env: { XAI_API_KEY: 'present' },
      exitCode: 0,
      stderr: '',
      stdout: positiveXai,
    }),
  ).toMatchObject({ ready: false, reason: 'competing' });
  expect(
    evaluateOpenCodeAuthList({
      env: { HOME: '/tmp/home' },
      exitCode: 0,
      stderr: '',
      stdout: environmentCompeting,
    }),
  ).toMatchObject({ ready: false, reason: 'competing' });
});
