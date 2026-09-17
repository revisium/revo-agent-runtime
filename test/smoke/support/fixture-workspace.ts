import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Host preparation for a fresh smoke workspace: approve only the owned fixture echo. */
export const prepareFixtureWorkspace = async (
  definitionId: string,
  workspace: string,
): Promise<void> => {
  if (definitionId === 'claude-acp') {
    const directory = join(workspace, '.claude');
    await mkdir(directory, { mode: 0o700 });
    await writeFile(
      join(directory, 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['mcp__knowledge__echo'] } }),
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  }
};
