import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createAgentManager,
  discoverAgents,
  type ActiveInvocationStateSink,
  type ActiveInvocationSnapshot,
  type AgentConfigurationCatalog,
  type AgentConfigurationSelection,
  type AgentDefinitionInput,
} from '../../src/index.js';
import { fakeAcpAgentDefinition } from '../support/fake-acp/definition.js';
import { strictResultSchema } from './support/fake-agent-definition.js';
import {
  builtInProviderIds,
  configurationSmokeProviders,
  type BuiltInProviderId,
} from './support/provider-selection.js';

const selected = process.env.REVO_LIVE_CONFIGURATION_SMOKE;

const bounded = (value: string): string => value.slice(0, 160);
const environment = Object.freeze({
  inherit: Object.freeze(['HOME', 'PATH'].filter((name) => process.env[name] !== undefined)),
  secrets: Object.freeze({}),
  variables: Object.freeze({}),
});

const activeState = (): {
  readonly ids: ReadonlySet<string>;
  readonly sink: ActiveInvocationStateSink;
} => {
  const ids = new Set<string>();
  return Object.freeze({
    ids,
    sink: Object.freeze({
      remove: async (invocationId: string) => {
        ids.delete(invocationId);
      },
      save: async (snapshot: ActiveInvocationSnapshot) => {
        ids.add(snapshot.invocationId);
      },
    }),
  });
};

const selectionFor = (catalog: AgentConfigurationCatalog): AgentConfigurationSelection =>
  Object.freeze({
    catalogRevision: catalog.catalogRevision,
    selections: Object.freeze(
      Object.fromEntries(
        catalog.options.map((option) => [
          option.id,
          option.type === 'select' && option.category === 'thought_level'
            ? (option.values.find((value) => value.value === 'low')?.value ?? option.currentValue)
            : option.currentValue,
        ]),
      ),
    ),
  });

const catalogSummary = (catalog: AgentConfigurationCatalog): readonly string[] => [
  `${catalog.agent.id}: options=${catalog.options.length}`,
  `model=${bounded(catalog.model?.currentModel ?? 'none')}`,
  `models=${catalog.model?.sessionAvailable.length ?? 0}`,
  `providers=${catalog.model?.providers.length ?? 0}`,
  ...catalog.options.map((option) =>
    option.type === 'select'
      ? `option=${bounded(option.id)};type=select;current=${bounded(option.currentValue)};values=${option.values.length}`
      : `option=${bounded(option.id)};type=boolean;current=${String(option.currentValue)}`,
  ),
];

const run = async (
  definition: AgentDefinitionInput,
  directory: string,
  live: boolean,
): Promise<void> => {
  const state = activeState();
  const manager = createAgentManager({
    activeStateSink: state.sink,
    definitions: [definition],
    ...(live ? { limits: { idleTimeoutMs: 30_000, wallClockTimeoutMs: 90_000 } } : {}),
  });
  let events = 0;
  let unsubscribe: (() => void) | undefined;
  try {
    await manager.initialize([]);
    unsubscribe = manager.subscribe({}, () => {
      events += 1;
    });
    const context = live ? { environment } : undefined;
    const catalog = await manager.inspectConfiguration(
      {
        agent: { id: definition.id, version: definition.version },
        workspace: { directory },
      },
      context,
    );
    for (const line of catalogSummary(catalog)) console.log(line);
    const invocationId = `${definition.id}-configuration-smoke`;
    const result = await (
      await manager.start(
        {
          agent: { id: definition.id, version: definition.version },
          configuration: selectionFor(catalog),
          invocationId,
          output: {
            directory: join(
              directory,
              `output-${createHash('sha256').update(invocationId).digest('hex')}`,
            ),
          },
          parameters: {},
          permissions: {},
          prompt: live
            ? 'Return exactly {"ok":true} and no other text.'
            : 'Return one JSON object.',
          result: { schema: live ? strictResultSchema : { type: 'object' } },
          workspace: { directory },
        },
        context,
      )
    ).result();
    if (state.ids.size !== 0) throw new Error('Configuration smoke left active state behind.');
    if (events === 0) throw new Error('Configuration smoke observed no lifecycle events.');
    console.log(`${definition.id}: turn=${result.status}; events=${events}; cleanup=confirmed`);
    if (result.status !== 'succeeded')
      throw new Error(`${definition.id} configuration turn ended with ${result.status}.`);
  } finally {
    unsubscribe?.();
    await manager.shutdown();
  }
};

const liveDefinitions = async (providers: readonly BuiltInProviderId[]) => {
  const discovery = await discoverAgents({
    disabledDetectorIds: builtInProviderIds.filter((provider) => !providers.includes(provider)),
  });
  return providers.map((provider) => {
    const definition = discovery.definitions.find(
      (candidate) => candidate.id === `${provider}-acp`,
    );
    if (definition === undefined)
      throw new Error(`${provider} configuration smoke is unavailable.`);
    return definition;
  });
};

const runDefinitions = async (
  definitions: readonly AgentDefinitionInput[],
  directory: string,
): Promise<void> => {
  const [definition, ...remaining] = definitions;
  if (definition === undefined) return;
  await run(definition, directory, true);
  await runDefinitions(remaining, directory);
};

const directory = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-configuration-'));
try {
  console.log('smoke:configuration');
  await run(
    fakeAcpAgentDefinition({
      displayName: 'Fake configuration',
      id: 'fake',
      mode: 'configuration',
    }),
    directory,
    false,
  );
  if (selected !== undefined) {
    await runDefinitions(await liveDefinitions(configurationSmokeProviders(selected)), directory);
  }
} finally {
  await rm(directory, { force: true, recursive: true });
}
