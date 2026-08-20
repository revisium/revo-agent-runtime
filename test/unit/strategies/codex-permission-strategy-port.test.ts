import { expect, test } from 'vitest';

import { CodexPermissionStrategy } from '../../../src/strategies/permissions/index.js';

test('maps generic mode and network template items through the codex permission request shape', () => {
  const effectivePermissions = Object.freeze({ mode: 'workspace-write', network: true });

  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'mode' }),
      effectivePermissions,
    }),
  ).toEqual({
    status: 'mapped',
    arguments: ['--sandbox=workspace-write', '--ask-for-approval=never'],
  });
  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'network' }),
      effectivePermissions,
    }),
  ).toEqual({
    status: 'mapped',
    arguments: ['--config', 'sandbox_workspace_write.network_access=true'],
  });
});

test('translates thrown codex permission errors into deterministic generic rejection', () => {
  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'mode' }),
      effectivePermissions: Object.freeze({ mode: 'read-only', network: true }),
    }),
  ).toEqual({ status: 'rejected', reason: 'permission_denied' });
});

test('rejects missing permission items unless they are optional', () => {
  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'network' }),
      effectivePermissions: Object.freeze({ mode: 'workspace-write' }),
    }),
  ).toEqual({ status: 'rejected', reason: 'permission_missing' });

  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'network', omitIfMissing: true }),
      effectivePermissions: Object.freeze({ mode: 'workspace-write' }),
    }),
  ).toEqual({ status: 'omitted' });
});

test('rejects invalid codex permission request shapes without throwing', () => {
  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'network' }),
      effectivePermissions: Object.freeze({ network: false }),
    }),
  ).toEqual({ status: 'rejected', reason: 'permission_invalid' });

  for (const effectivePermissions of [
    Object.freeze({ mode: 'unrestricted', network: false }),
    Object.freeze({ mode: 'workspace-write', network: 'enabled' }),
    Object.freeze({ mode: 'workspace-write', network: false, allowDangerFullAccess: 'yes' }),
    Object.freeze({ mode: 'workspace-write', network: false, profile: 'strict' }),
  ]) {
    expect(
      CodexPermissionStrategy.map({
        item: Object.freeze({
          kind: 'permission',
          name: Object.hasOwn(effectivePermissions, 'profile') ? 'profile' : 'mode',
        }),
        effectivePermissions,
      }),
    ).toEqual({ status: 'rejected', reason: 'permission_invalid' });
  }
});

test('maps explicitly admitted danger-full-access and denies it otherwise', () => {
  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'mode' }),
      effectivePermissions: Object.freeze({
        mode: 'danger-full-access',
        network: true,
        allowDangerFullAccess: true,
      }),
    }),
  ).toEqual({
    status: 'mapped',
    arguments: ['--sandbox=danger-full-access', '--ask-for-approval=never'],
  });

  expect(
    CodexPermissionStrategy.map({
      item: Object.freeze({ kind: 'permission', name: 'mode' }),
      effectivePermissions: Object.freeze({ mode: 'danger-full-access', network: false }),
    }),
  ).toEqual({ status: 'rejected', reason: 'permission_denied' });
});
