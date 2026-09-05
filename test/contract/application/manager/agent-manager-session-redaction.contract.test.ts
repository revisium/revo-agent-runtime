import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { createAgentManager, type AgentSessionEvent } from '../../../../src/index.js';
import { fakeAcpDefinition } from '../../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../../support/stories/active-state.js';

test('manager redaction protects session results, durable events and process output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'revo-session-redaction-'));
  const marker = 'synthetic-session-secret';
  const events: AgentSessionEvent[] = [];
  const manager = createAgentManager({
    definitions: [fakeAcpDefinition({ mode: 'session' })],
    activeStateSink: noOpActiveStateSink,
    redaction: { secrets: [marker] },
    sessions: {
      activeStateSink: {
        save: async () => ({ state: 'applied' }),
        remove: async () => ({ state: 'applied' }),
      },
      eventSink: {
        append: async (event) => {
          events.push(event);
          return { state: 'appended' };
        },
      },
    },
  });
  try {
    await manager.initialize([]);
    const session = await manager.sessions.open({
      agent: { id: 'codex', version: '1.0.0' },
      sessionId: 'dlg_redaction',
      workspace: { directory },
      output: { directory: join(directory, 'output') },
      parameters: {},
      permissions: {},
    });
    await (await session.send({ prompt: marker, turnId: 'trn_remember' })).result();
    const result = await (await session.send({ prompt: 'recall', turnId: 'trn_recall' })).result();
    await session.close();
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(events)).not.toContain(marker);
    expect(await readFile(join(directory, 'output', 'stdout.log'), 'utf8')).not.toContain(marker);
  } finally {
    await manager.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
