import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createAgentManager,
  discoverAgents,
  type ActiveInvocationStateSink,
  type AgentDefinitionInput,
  type AgentInvocationResult,
  type AgentProbeResult,
} from '../../src/index.js';
import { fakeAgentDefinition, strictResultSchema } from './support/fake-agent-definition.js';
import {
  agentSmokeProviders,
  builtInProviderIds,
  type BuiltInProviderId,
} from './support/provider-selection.js';

const selection = process.env.REVO_LIVE_AGENT_SMOKE;

const fakeDefinition = fakeAgentDefinition('ok-result');

const recordingSink = (): {
  readonly activeIds: ReadonlySet<string>;
  readonly sink: ActiveInvocationStateSink;
} => {
  const activeIds = new Set<string>();
  return {
    activeIds,
    sink: {
      remove: async (invocationId) => {
        activeIds.delete(invocationId);
      },
      save: async (snapshot) => {
        activeIds.add(snapshot.invocationId);
      },
    },
  };
};

const assertNoActiveRows = (activeIds: ReadonlySet<string>): void => {
  if (activeIds.size !== 0) throw new Error('Agent smoke left active invocation state behind.');
};
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const liveEnvironment = Object.freeze({
  inherit: Object.freeze(['HOME', 'PATH'].filter((name) => process.env[name] !== undefined)),
  secrets: Object.freeze({}),
  variables: Object.freeze({}),
});

const invocationOutputDirectory = (parent: string, invocationId: string): string =>
  join(parent, `output-${createHash('sha256').update(invocationId).digest('hex')}`);

const requestFor = (
  definition: AgentDefinitionInput,
  invocationId: string,
  directory: string,
  prompt: string,
) => ({
  agent: { id: definition.id, version: definition.version },
  invocationId,
  output: { directory: invocationOutputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt,
  result: { schema: strictResultSchema },
  workspace: { directory },
});

const probeSummary = (name: string, probe: AgentProbeResult) =>
  probe.status === 'available'
    ? `${name}: probe=available; version=reported`
    : `${name}: probe=unavailable; code=${probe.error.code}`;

const probeAgent = async (
  manager: ReturnType<typeof createAgentManager>,
  definition: AgentDefinitionInput,
) => manager.probeAgent({ id: definition.id, version: definition.version });

interface SmokeOutcome {
  readonly eventCount: number;
  readonly result: AgentInvocationResult;
}

const assertObservedEvents = (eventCount: number): void => {
  if (eventCount === 0)
    throw new Error('Agent smoke did not observe any subscribed lifecycle event.');
};

const run = async (
  definition: AgentDefinitionInput,
  invocationId: string,
  directory: string,
  live: boolean = false,
) => {
  const state = recordingSink();
  const manager = createAgentManager({
    activeStateSink: state.sink,
    definitions: [definition],
    ...(live ? { limits: { idleTimeoutMs: 30_000, wallClockTimeoutMs: 60_000 } } : {}),
  });
  let unsubscribe: (() => void) | undefined;
  let eventCount = 0;
  try {
    await manager.initialize([]);
    const subscription = manager.subscribe({}, () => {
      eventCount += 1;
    });
    unsubscribe = subscription;
    console.log(probeSummary(definition.id, await probeAgent(manager, definition)));
    const result = await (
      await manager.start(
        requestFor(
          definition,
          invocationId,
          directory,
          'Return exactly one JSON object with an ok field and no other text.',
        ),
        live ? { environment: liveEnvironment } : undefined,
      )
    ).result();
    if (result.status !== 'succeeded')
      throw new Error(`Selected success smoke ended with ${result.status}.`);
    assertNoActiveRows(state.activeIds);
    assertObservedEvents(eventCount);
    subscription();
    unsubscribe = undefined;
    return { eventCount, result };
  } finally {
    unsubscribe?.();
    await manager.shutdown();
  }
};

const cancellationPromptFor = (definition: AgentDefinitionInput): string =>
  definition.id === 'fake-acp'
    ? 'Remain active until cancelled.'
    : 'Run the read-only shell command sleep 30, then return exactly {"ok":true}.';

const cancellationContextFor = (definition: AgentDefinitionInput) =>
  definition.id === 'fake-acp' ? undefined : { environment: liveEnvironment };

const runCancellation = async (definition: AgentDefinitionInput, directory: string) => {
  const state = recordingSink();
  const manager = createAgentManager({
    activeStateSink: state.sink,
    definitions: [definition],
    limits: { idleTimeoutMs: 10_000, wallClockTimeoutMs: 20_000 },
  });
  let unsubscribe: (() => void) | undefined;
  let eventCount = 0;
  try {
    await manager.initialize([]);
    const subscription = manager.subscribe({}, () => {
      eventCount += 1;
    });
    unsubscribe = subscription;
    console.log(probeSummary(`${definition.id}-cancel`, await probeAgent(manager, definition)));
    const handle = await manager.start(
      requestFor(
        definition,
        `${definition.id}-cancellation-smoke`,
        directory,
        cancellationPromptFor(definition),
      ),
      cancellationContextFor(definition),
    );
    await delay(1_500);
    await handle.cancel('manual cancellation smoke');
    const result = await handle.result();
    if (result.status !== 'cancelled')
      throw new Error(`Selected cancellation smoke ended with ${result.status}.`);
    assertNoActiveRows(state.activeIds);
    assertObservedEvents(eventCount);
    subscription();
    unsubscribe = undefined;
    return { eventCount, result };
  } finally {
    unsubscribe?.();
    await manager.shutdown();
  }
};

const summary = (name: string, outcome: SmokeOutcome): string => {
  const { eventCount, result } = outcome;
  return [
    `${name}: status=${result.status}`,
    'launch=selected-definition/version-reported',
    `exit=code:${result.exit.code ?? 'none'},signal:${result.exit.signal ?? 'none'}`,
    `durationMs=${result.durationMs}`,
    `events=${eventCount}`,
    'cleanup=confirmed',
    `files=${[
      result.files.events,
      result.files.stderr,
      result.files.stdout,
      ...(result.files.result === undefined ? [] : [result.files.result]),
      ...(result.files.rawFinalResponse === undefined ? [] : [result.files.rawFinalResponse]),
    ].join(',')}`,
    ...(result.status === 'succeeded' ? [] : [`fault=${result.error.code}`]),
  ].join('; ');
};

interface SelectedProvider {
  readonly definitionId: string;
  readonly detectorId: BuiltInProviderId;
}

const selectedProvider = (detectorId: BuiltInProviderId): SelectedProvider => ({
  definitionId: `${detectorId}-acp`,
  detectorId,
});

const runSelectedProviders = async (
  providers: readonly SelectedProvider[],
  directory: string,
): Promise<void> => {
  const [provider, ...remaining] = providers;
  if (provider === undefined) return;
  const discovery = await discoverAgents({
    disabledDetectorIds: builtInProviderIds.filter(
      (detectorId) => detectorId !== provider.detectorId,
    ),
  });
  const definition = discovery.definitions.find(
    (candidate) => candidate.id === provider.definitionId,
  );
  if (definition === undefined) throw new Error('Selected ACP bridge is unavailable.');
  console.log(
    summary(definition.id, await run(definition, `${definition.id}-smoke`, directory, true)),
  );
  if (definition.capabilities.cancellation) {
    console.log(summary(`${definition.id}-cancel`, await runCancellation(definition, directory)));
  }
  await runSelectedProviders(remaining, directory);
};

const directory = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-smoke-'));

try {
  console.log('smoke:agent');
  console.log(summary('fake-acp', await run(fakeDefinition, 'fake-acp-smoke', directory)));
  console.log(
    summary('fake-acp-cancel', await runCancellation(fakeAgentDefinition('hang'), directory)),
  );

  if (selection !== undefined) {
    await runSelectedProviders(agentSmokeProviders(selection).map(selectedProvider), directory);
  }
} finally {
  await rm(directory, { force: true, recursive: true });
}
