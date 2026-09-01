import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager } from '../../../src/index.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
};

const readCreatedPid = async (path: string): Promise<number> => {
  const deadline = Date.now() + 2_000;
  const poll = async (): Promise<number> => {
    try {
      return Number((await readFile(path, 'utf8')).trim());
    } catch (error) {
      if (
        !(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
      if (Date.now() >= deadline)
        throw new Error('Stubborn descendant fixture did not report its pid.', { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 10));
      return poll();
    }
  };
  return poll();
};

test.skipIf(process.platform !== 'linux')(
  'escalates from TERM to KILL and confirms a stubborn descendant is gone',
  async () => {
    await withTemporaryDirectory(async (directory) => {
      const descendantPidFile = join(directory, 'descendant.pid');
      const manager = createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: [fakeAcpDefinition({ descendantPidFile, mode: 'stubborn-descendant' })],
      });
      await manager.initialize([]);
      const handle = await manager.start({
        agent: { id: 'codex', version: '1.0.0' },
        invocationId: 'stubborn-descendant',
        output: { directory: invocationOutputDirectory(directory, 'stubborn-descendant') },
        parameters: {},
        permissions: {},
        prompt: 'Spawn the process-tree fixture.',
        result: { schema: { type: 'object' } },
        workspace: { directory },
      });
      const descendantPid = await readCreatedPid(descendantPidFile);

      await handle.cancel();
      const result = await handle.result();
      await manager.shutdown();

      expect(result).toMatchObject({ status: 'cancelled' });
      expect(processExists(descendantPid)).toBe(false);
    });
  },
  10_000,
);
