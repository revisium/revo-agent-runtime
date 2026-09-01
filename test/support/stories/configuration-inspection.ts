import { normalizeAcpConfiguration } from '../../../src/configuration/catalog.js';
import { validateAgentDefinition } from '../../../src/definition/index.js';
import type { ConfigurationCatalogFallback } from '../../../src/execution/configuration/fallback.js';
import {
  createConfigurationInspector,
  type ConfigurationInspectionOutcome,
} from '../../../src/execution/configuration/inspector.js';
import {
  ProcessStartError,
  type OwnedProcess,
  type ProcessCleanupOutcome,
  type ProcessExit,
} from '../../../src/execution/process/port.js';
import type {
  ProtocolConfigurationDriver,
  ProtocolConfigurationSession,
} from '../../../src/protocol/configuration-driver.js';
import { agentDefinition } from '../builders/agent-definition.js';
import { processIdentity } from '../builders/process-identity.js';

type Failure = 'confirmed-start' | 'error' | 'uncertain-start';
type ProtocolOpening = 'exits' | 'hangs' | 'opens' | 'rejects';

interface ProcessBehavior {
  readonly cleanup: ProcessCleanupOutcome['status'];
  readonly exit?: ProcessExit;
  readonly failure?: Failure;
}

interface FallbackBehavior extends ProcessBehavior {
  readonly output: Uint8Array;
  readonly parseFails: boolean;
}

const never = <T>(): Promise<T> => new Promise(() => undefined);

const exit = (overrides: Partial<ProcessExit> = {}): ProcessExit => ({
  exitCode: 0,
  signal: null,
  ...overrides,
});

const cleanup = (
  status: ProcessCleanupOutcome['status'],
  completed: ProcessExit,
): ProcessCleanupOutcome => (status === 'confirmed' ? { exit: completed, status } : { status });

const ownedProcess = (behavior: ProcessBehavior): OwnedProcess => {
  const completed = behavior.exit ?? exit();
  return {
    completion: behavior.exit === undefined ? never() : Promise.resolve(completed),
    identity: processIdentity(),
    terminateAndReap: async () => cleanup(behavior.cleanup, completed),
    transport: {
      input: new WritableStream<Uint8Array>(),
      output: new ReadableStream<Uint8Array>(),
    },
  };
};

const throwStartFailure = (failure: Failure | undefined): void => {
  if (failure === 'error') throw new Error('fixture start failure');
  if (failure !== undefined)
    throw new ProcessStartError(failure === 'uncertain-start' ? 'uncertain' : 'confirmed');
};

export interface ConfigurationInspectionStory {
  readonly abort: () => void;
  readonly execute: () => Promise<ConfigurationInspectionOutcome>;
  readonly fallbackCleanupIsUncertain: () => ConfigurationInspectionStory;
  readonly fallbackExits: (overrides?: Partial<ProcessExit>) => ConfigurationInspectionStory;
  readonly fallbackOutputIsTruncated: () => ConfigurationInspectionStory;
  readonly fallbackParseFails: () => ConfigurationInspectionStory;
  readonly fallbackStartFails: (failure: Failure) => ConfigurationInspectionStory;
  readonly primaryCleanupIsUncertain: () => ConfigurationInspectionStory;
  readonly primaryStartFails: (failure: Failure) => ConfigurationInspectionStory;
  readonly protocolCloseFails: () => ConfigurationInspectionStory;
  readonly protocolCloseHangs: () => ConfigurationInspectionStory;
  readonly protocolExitsBeforeOpening: () => ConfigurationInspectionStory;
  readonly protocolHangs: () => ConfigurationInspectionStory;
  readonly protocolRejects: () => ConfigurationInspectionStory;
  readonly useFallback: () => ConfigurationInspectionStory;
  readonly useUnsupportedLaunch: () => ConfigurationInspectionStory;
}

export const configurationInspectionStory = (): ConfigurationInspectionStory => {
  const controller = new AbortController();
  const primary: { behavior: ProcessBehavior } = {
    behavior: { cleanup: 'confirmed' },
  };
  const fallback: { behavior: FallbackBehavior; enabled: boolean; truncated: boolean } = {
    behavior: {
      cleanup: 'confirmed',
      output: new TextEncoder().encode('models'),
      parseFails: false,
    },
    enabled: false,
    truncated: false,
  };
  let opening: ProtocolOpening = 'opens';
  let closeFails = false;
  let closeHangs = false;
  let unsupportedLaunch = false;
  const catalog = normalizeAcpConfiguration([
    {
      currentValue: 'fixture-model',
      id: 'model',
      name: 'Model',
      options: [{ name: 'Fixture model', value: 'fixture-model' }],
      type: 'select',
    },
  ]);
  const openedSession = () => ({
    catalog: fallback.enabled ? normalizeAcpConfiguration([]) : catalog,
    close: async () => {
      if (closeHangs) await never<void>();
      if (closeFails) throw new Error('fixture close failure');
    },
  });
  const protocol: ProtocolConfigurationDriver = {
    inspect: async () => {
      if (opening === 'rejects') throw new Error('fixture protocol failure');
      if (opening === 'hangs') return never<ProtocolConfigurationSession>();
      if (opening === 'exits')
        return new Promise<ProtocolConfigurationSession>((resolve) =>
          setTimeout(() => resolve(openedSession()), 0),
        );
      return openedSession();
    },
  };
  const fallbackPort: ConfigurationCatalogFallback = {
    args: ['models'],
    parse: () => {
      if (fallback.behavior.parseFails) throw new Error('fixture parse failure');
      return catalog;
    },
  };
  const story: ConfigurationInspectionStory = {
    abort: () => controller.abort(),
    execute: async () => {
      let starts = 0;
      const inspector = createConfigurationInspector(
        {
          start: async (launch) => {
            const selected = starts++ === 0 ? primary.behavior : fallback.behavior;
            throwStartFailure(selected.failure);
            if (selected === fallback.behavior) {
              if (fallback.truncated) launch.onStdout?.(new Uint8Array(64).fill(120));
              else launch.onStdout?.(fallback.behavior.output);
            }
            if (opening === 'exits' && selected === primary.behavior)
              return ownedProcess({ ...selected, exit: exit() });
            return ownedProcess(selected);
          },
        },
        protocol,
        () => (fallback.enabled ? fallbackPort : undefined),
      );
      const definition = validateAgentDefinition(
        agentDefinition(
          unsupportedLaunch
            ? {
                launch: {
                  args: [{ kind: 'workspace' }],
                  command: 'fixture-agent',
                  versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
                },
              }
            : {},
        ),
      ).definition;
      const outcome = await inspector.inspect({
        definition,
        environment: {},
        idleTimeoutMs: 10,
        launch: { executable: '/fixture/agent', reportedVersion: '1.0.0' },
        maxOutputBytes: fallback.truncated ? 32 : 1_024,
        redactionSecrets: [],
        signal: controller.signal,
        wallClockTimeoutMs: 10,
        workspace: '/fixture/workspace',
      });
      if (opening === 'exits') await new Promise((resolve) => setTimeout(resolve, 0));
      return outcome;
    },
    fallbackCleanupIsUncertain: () => {
      fallback.behavior = { ...fallback.behavior, cleanup: 'uncertain' };
      return story;
    },
    fallbackExits: (overrides = {}) => {
      fallback.behavior = { ...fallback.behavior, exit: exit(overrides) };
      return story;
    },
    fallbackOutputIsTruncated: () => {
      fallback.truncated = true;
      return story;
    },
    fallbackParseFails: () => {
      fallback.behavior = { ...fallback.behavior, parseFails: true };
      return story;
    },
    fallbackStartFails: (failure) => {
      fallback.behavior = { ...fallback.behavior, failure };
      return story;
    },
    primaryCleanupIsUncertain: () => {
      primary.behavior = { ...primary.behavior, cleanup: 'uncertain' };
      return story;
    },
    primaryStartFails: (failure) => {
      primary.behavior = { ...primary.behavior, failure };
      return story;
    },
    protocolCloseFails: () => {
      closeFails = true;
      return story;
    },
    protocolCloseHangs: () => {
      closeHangs = true;
      return story;
    },
    protocolExitsBeforeOpening: () => {
      opening = 'exits';
      return story;
    },
    protocolHangs: () => {
      opening = 'hangs';
      return story;
    },
    protocolRejects: () => {
      opening = 'rejects';
      return story;
    },
    useFallback: () => {
      fallback.enabled = true;
      return story;
    },
    useUnsupportedLaunch: () => {
      unsupportedLaunch = true;
      return story;
    },
  };
  return Object.freeze(story);
};
