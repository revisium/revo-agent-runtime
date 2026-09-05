import { expect, test } from 'vitest';

import { ClaimedInvocationOutput } from '../../../../../src/execution/output/claim.js';
import type { NodeOutputPublicationSystem } from '../../../../../src/platform/node/output/publication.js';
import { createNodeSessionOutputTarget } from '../../../../../src/platform/node/output/session/publication.js';

interface FakeSystemOptions {
  readonly failLink?: Readonly<{ filename: string; existing: boolean }>;
  readonly failOpen?: string;
  readonly failWrite?: string;
  readonly failDirectorySync?: boolean | string;
}

const fakeSystem = (options: FakeSystemOptions = {}) => {
  const writes = new Map<string, Uint8Array>();
  const links: string[] = [];
  let lastLinked = '';
  const system: NodeOutputPublicationSystem = {
    link: async (_temporary, final) => {
      const filename = final.split('/').at(-1) ?? '';
      if (options.failLink?.filename === filename)
        throw Object.assign(new Error('link failed'), {
          code: options.failLink.existing ? 'EEXIST' : 'EIO',
        });
      links.push(filename);
      lastLinked = filename;
    },
    open: async (path) => {
      const filename =
        path
          .split('/')
          .at(-1)
          ?.replace(/^\./u, '')
          .replace(/\.revo-tmp$/u, '') ?? '';
      if (options.failOpen === filename) throw new Error('open failed');
      return {
        close: async () => undefined,
        sync: async () => undefined,
        writeFile: async (bytes) => {
          if (options.failWrite === filename) throw new Error('write failed');
          writes.set(filename, bytes);
        },
      };
    },
    openDirectory: async () => ({
      close: async () => undefined,
      sync: async () => {
        if (options.failDirectorySync === true || options.failDirectorySync === lastLinked)
          throw new Error('sync failed');
      },
    }),
    unlink: async () => undefined,
  };
  return { links, system, writes };
};

const input = (withOptionalFields: boolean = true) => ({
  acceptedAt: '2026-09-05T00:00:00.000Z',
  ...(withOptionalFields
    ? {
        cursor: { eventId: 'event', sequence: 3, streamId: 'stream' },
        openedAt: '2026-09-05T00:00:01.000Z',
      }
    : {}),
  finishedAt: '2026-09-05T00:01:00.000Z',
  pin: { agentId: 'fake', agentVersion: '1', definitionDigest: 'digest' },
  sessionId: 'dlg_output',
  status: 'closed' as const,
  stderr: new TextEncoder().encode('stderr'),
  stdout: new TextEncoder().encode('stdout'),
  truncated: { stderr: false, stdout: false },
});

test('atomically publishes session streams and a bounded manifest', async () => {
  const fake = fakeSystem();
  const target = createNodeSessionOutputTarget(
    ClaimedInvocationOutput.create('/output'),
    fake.system,
  );

  await expect(target.publish(input())).resolves.toEqual({
    files: {
      directory: '/output',
      manifest: 'session.json',
      stderr: 'stderr.log',
      stdout: 'stdout.log',
    },
    state: 'published',
  });
  expect(fake.links).toEqual(['stdout.log', 'stderr.log', 'session.json']);
  expect(JSON.parse(new TextDecoder().decode(fake.writes.get('session.json')))).toMatchObject({
    cursor: { sequence: 3 },
    openedAt: '2026-09-05T00:00:01.000Z',
    schemaVersion: 'agent-session-output/v1',
    sessionId: 'dlg_output',
  });
  await expect(target.publish(input(false))).resolves.toMatchObject({
    files: { directory: '' },
    state: 'failed',
  });
});

test.each([
  ['stdout open', { failOpen: 'stdout.log' }, 'failed', {}],
  [
    'stderr existing link',
    { failLink: { existing: true, filename: 'stderr.log' } },
    'failed',
    { stdout: 'stdout.log' },
  ],
  [
    'manifest uncertain link',
    { failLink: { existing: false, filename: 'session.json' } },
    'uncertain',
    { stderr: 'stderr.log', stdout: 'stdout.log' },
  ],
  ['manifest directory sync', { failDirectorySync: true }, 'uncertain', { stdout: 'stdout.log' }],
  [
    'manifest committed before directory sync failure',
    { failDirectorySync: 'session.json' },
    'uncertain',
    { manifest: 'session.json', stderr: 'stderr.log', stdout: 'stdout.log' },
  ],
] as const)('reports partial publication when %s fails', async (_label, options, state, files) => {
  const fake = fakeSystem(options);
  const target = createNodeSessionOutputTarget(
    ClaimedInvocationOutput.create('/output'),
    fake.system,
  );

  await expect(target.publish(input(false))).resolves.toMatchObject({ files, state });
});

test('contains an unexpected publication input failure and closes the lease', async () => {
  const fake = fakeSystem();
  const claim = ClaimedInvocationOutput.create('/output');
  const target = createNodeSessionOutputTarget(claim, fake.system);
  const hostile = Object.defineProperty(input(false), 'stdout', {
    enumerable: true,
    get: () => {
      throw new Error('hostile getter');
    },
  });

  await expect(target.publish(hostile)).resolves.toMatchObject({
    files: { directory: '/output' },
    state: 'failed',
  });
  await expect(target.publish(input(false))).resolves.toMatchObject({ state: 'failed' });
});
