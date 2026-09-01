import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createAgentManager, type StartAgentInvocation } from '../../../src/index.js';
import { fakeAcpDefinition } from '../fakes/fake-acp.js';
import { noOpActiveStateSink } from '../stories/active-state.js';

export const publicAgentManager = (mode: string = 'success') =>
  createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions: [fakeAcpDefinition({ mode })],
  });

export const invocationOutputDirectory = (parent: string, invocationId: string): string =>
  join(parent, `output-${createHash('sha256').update(invocationId).digest('hex')}`);

export const publicInvocationRequest = (
  directory: string,
  invocationId: string,
): StartAgentInvocation => ({
  agent: { id: 'codex', version: '1.0.0' },
  invocationId,
  output: { directory: invocationOutputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: process.cwd() },
});

export const readPublicOutput = (
  directory: string,
  files: readonly string[],
): Promise<readonly string[]> =>
  Promise.all(files.map((file) => readFile(join(directory, file), 'utf8')));
