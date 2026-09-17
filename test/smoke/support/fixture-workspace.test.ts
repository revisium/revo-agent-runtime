import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { prepareFixtureWorkspace } from './fixture-workspace.js';

test('fixture setup refuses to overwrite an existing host permission policy', async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(join(root, '.claude'));
    const policy = join(root, '.claude', 'settings.local.json');
    await writeFile(policy, '{"permissions":{"deny":["mcp__knowledge__echo"]}}');
    await expect(prepareFixtureWorkspace('claude-acp', root)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(policy, 'utf8')).toContain('"deny"');
  });
});
