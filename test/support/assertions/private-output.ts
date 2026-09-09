import { stat } from 'node:fs/promises';

import { execa } from 'execa';
import { expect } from 'vitest';

const aclInspection = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$results = @(($env:REVO_TEST_PRIVATE_PATHS | ConvertFrom-Json) | ForEach-Object {
$item = if ([System.IO.Directory]::Exists($_)) { [System.IO.DirectoryInfo]::new($_) } else { [System.IO.FileInfo]::new($_) }
$acl = $item.GetAccessControl()
$rules = @($acl.Access | ForEach-Object {
  @{
    sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    allowed = $_.AccessControlType -eq 'Allow'
    fullControl = ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl
  }
})
@{ currentUser = $sid; rules = $rules }
})
ConvertTo-Json -InputObject $results -Depth 4 -Compress
`;

export const expectPrivateOutput = async (
  entries: readonly { readonly path: string; readonly mode: number }[],
): Promise<void> => {
  const paths = entries.map(({ path }) => path);
  if (process.platform !== 'win32') {
    const modes = await Promise.all(paths.map(async (path) => (await stat(path)).mode & 0o777));
    expect(modes).toEqual(entries.map(({ mode }) => mode));
    return;
  }
  const { stdout } = await execa(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(aclInspection, 'utf16le').toString('base64'),
    ],
    { env: { REVO_TEST_PRIVATE_PATHS: JSON.stringify(paths) }, timeout: 10_000 },
  );
  const observed: unknown = JSON.parse(stdout);
  if (!Array.isArray(observed)) throw new Error('Expected ACL inspections.');
  expect(observed).toHaveLength(paths.length);
  for (const inspection of observed as readonly unknown[]) {
    expect(inspection).toEqual({
      currentUser: expect.any(String),
      rules: [{ allowed: true, fullControl: true, sid: expect.any(String) }],
    });
    // The only allowed SID must be the runtime user, including inherited file ACEs.
    if (typeof inspection !== 'object' || inspection === null || !('currentUser' in inspection))
      throw new Error('Expected an ACL inspection.');
    expect(inspection).toMatchObject({ rules: [{ sid: inspection.currentUser }] });
  }
};
