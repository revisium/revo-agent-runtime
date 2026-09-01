import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  createAgentManager,
  type ActiveInvocationSnapshot,
  type ActiveInvocationStateSink,
  type AgentDefinitionInput,
} from '../../src/index.js';
import { fakeAgentDefinition, strictResultSchema } from './support/fake-agent-definition.js';

const outputDirectory = (parent: string, invocationId: string): string =>
  join(parent, `output-${createHash('sha256').update(invocationId).digest('hex')}`);

const requestFor = (
  definition: AgentDefinitionInput,
  invocationId: string,
  directory: string,
  prompt: string,
) => ({
  agent: { id: definition.id, version: definition.version },
  invocationId,
  output: { directory: outputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt,
  result: { schema: strictResultSchema },
  workspace: { directory },
});

const timed = async <Value>(operation: Promise<Value>, label: string): Promise<Value> =>
  Promise.race([
    operation,
    delay(10_000).then(() => {
      throw new Error(`${label} did not settle within the manual smoke deadline.`);
    }),
  ]);

const processIsAbsent = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ESRCH';
  }
};

const definition = fakeAgentDefinition('recovery');
const active = new Map<string, ActiveInvocationSnapshot>();
let resolveOriginalSnapshot!: (snapshot: ActiveInvocationSnapshot) => void;
const originalSnapshot = new Promise<ActiveInvocationSnapshot>((resolve) => {
  resolveOriginalSnapshot = resolve;
});
const sink: ActiveInvocationStateSink = {
  remove: async (invocationId) => {
    active.delete(invocationId);
  },
  save: async (snapshot) => {
    active.set(snapshot.invocationId, snapshot);
    if (snapshot.invocationId === 'before-restart') resolveOriginalSnapshot(snapshot);
  },
};
const managerOptions = {
  activeStateSink: sink,
  definitions: [definition],
  limits: { idleTimeoutMs: 30_000, wallClockTimeoutMs: 30_000 },
};
const originalManager = createAgentManager(managerOptions);
const replacementManager = createAgentManager(managerOptions);
const directory = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-recovery-smoke-'));
const originalEvents: string[] = [];
const replacementEvents: string[] = [];
let unsubscribeOriginal: (() => void) | undefined;
let unsubscribeReplacement: (() => void) | undefined;

try {
  await originalManager.initialize([]);
  unsubscribeOriginal = originalManager.subscribe({}, ({ type }) => originalEvents.push(type));
  const originalHandle = await originalManager.start(
    requestFor(
      definition,
      'before-restart',
      directory,
      'Please remain active until the replacement runtime reconciles this invocation.',
    ),
  );
  const persisted = await timed(originalSnapshot, 'active-state persistence');

  await timed(replacementManager.initialize([persisted]), 'replacement initialization');
  if (!processIsAbsent(persisted.process.pid))
    throw new Error('Replacement runtime did not confirm the orphan process was reaped.');
  if (active.has(persisted.invocationId))
    throw new Error('Replacement runtime did not remove the recovered active-state row.');
  if (replacementManager.getResult(persisted.invocationId).state !== 'unknown')
    throw new Error('Recovered invocations must not masquerade as reattached handles.');

  await timed(originalHandle.result(), 'original invocation drainage');
  unsubscribeReplacement = replacementManager.subscribe({}, ({ type }) =>
    replacementEvents.push(type),
  );
  const replacementResult = await (
    await replacementManager.start(
      requestFor(
        definition,
        'after-restart',
        directory,
        'Return exactly one JSON object with an ok field and no other text.',
      ),
    )
  ).result();
  if (replacementResult.status !== 'succeeded')
    throw new Error(`Replacement runtime invocation ended with ${replacementResult.status}.`);
  if (originalEvents.length === 0 || replacementEvents.length === 0)
    throw new Error('Manual recovery smoke did not observe both lifecycle subscriptions.');
  if (active.size !== 0) throw new Error('Manual recovery smoke left active-state rows behind.');

  console.log('smoke:recovery');
  console.log(
    [
      'original=orphan-reaped',
      'persisted-row=removed',
      'reattach=unsupported',
      'replacement=initialized',
      'replacement-run=succeeded',
      `events=original:${originalEvents.length},replacement:${replacementEvents.length}`,
    ].join('; '),
  );
} finally {
  unsubscribeReplacement?.();
  unsubscribeOriginal?.();
  await replacementManager.shutdown().catch(() => undefined);
  await originalManager.shutdown().catch(() => undefined);
  await rm(directory, { force: true, recursive: true });
}
