import { expect, test } from 'vitest';

import { recoverySnapshots } from '../../../../src/application/active-state/recovery-snapshots.js';
import { recoverySessionSnapshots } from '../../../../src/application/session/management/recovery-snapshots.js';
import { createSealedAgentRegistry } from '../../../../src/definition/index.js';
import type { AgentDescriptor } from '../../../../src/index.js';
import { agentDefinition } from '../../../support/builders/agent-definition.js';
import { recoverySnapshot } from '../../../support/stories/recovery.js';

const registry = createSealedAgentRegistry([agentDefinition()]);
const invocation = recoverySnapshot('inv_existing');
const agents: readonly AgentDescriptor[] = [
  {
    agent: {
      id: invocation.pin.agentId,
      version: invocation.pin.agentVersion,
      installationId: 'fixture-installation',
    },
    capabilities: { cancellation: true, structuredResult: true, usage: false },
    definitionDigest: invocation.pin.definitionDigest,
    displayName: 'Fixture agent',
  },
];
const session = {
  acceptedAt: '2026-01-01T00:00:00.000Z',
  incarnationId: 'inc_existing',
  pin: invocation.pin,
  process: invocation.process,
  sessionId: 'session_existing',
  state: 'idle',
};
const readers = [
  ['invocation', (process: unknown) => recoverySnapshots([{ ...invocation, process }], registry)],
  ['session', (process: unknown) => recoverySessionSnapshots([{ ...session, process }], agents)],
] as const;

for (const [name, read] of readers) {
  test.each(['linux', 'darwin', 'win32'] as const)(
    `${name} recovery preserves versioned %s ownership evidence`,
    (platform) => {
      const evidence = {
        pid: 42,
        fingerprint: `sha256:${'a'.repeat(64)}`,
        startedAt: '2026-01-01T00:00:00.000Z',
        version: 2,
        platform,
      };
      const identity =
        platform === 'win32'
          ? { ...evidence, jobName: 'revo-12345678-1234-1234-1234-123456789abc' }
          : { ...evidence, processGroupId: 42 };

      const snapshots = read(identity);

      expect(snapshots).toHaveLength(1);
      expect(snapshots?.[0]?.process).toEqual(identity);
      expect(snapshots?.[0]?.process).not.toBe(identity);
      expect(Object.isFrozen(snapshots?.[0]?.process)).toBe(true);
    },
  );

  test(`${name} recovery rejects an unsupported persisted identity version`, () => {
    expect(read({ ...invocation.process, version: 3, platform: 'linux' })).toBeUndefined();
  });

  test.each(['ownKeys', 'getOwnPropertyDescriptor'] as const)(
    `${name} recovery contains a process identity %s trap`,
    (trap) => {
      const identity = new Proxy(invocation.process, {
        [trap]: () => {
          throw new Error('Hostile persisted data');
        },
      });

      expect(read(identity)).toBeUndefined();
    },
  );
}
