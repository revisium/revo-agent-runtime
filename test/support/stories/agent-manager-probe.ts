import { createAgentManager } from '../../../src/application/manager/manager.js';
import type { AgentRef } from '../../../src/contracts/agent-definition.js';
import type { StartAgentInvocation } from '../../../src/contracts/manager.js';
import type {
  ExecutablePreflight,
  ExecutablePreflightFailure,
  ExecutablePreflightOutcome,
} from '../../../src/execution/probe/executable-preflight.js';
import { agentDefinition } from '../builders/agent-definition.js';
import { managerOptions, managerServices } from '../builders/manager-services.js';

type ProbeScenario =
  | 'available'
  | 'aborted'
  | 'throws'
  | ExecutablePreflightFailure['reason']
  | 'pending';

const aborted = (): ExecutablePreflightOutcome => Object.freeze({ status: 'aborted' });

const available = (): ExecutablePreflightOutcome =>
  Object.freeze({
    launch: Object.freeze({ executable: '/resolved/runtime-agent', reportedVersion: '2.4.0' }),
    status: 'ready',
  });

const rejected = (reason: ExecutablePreflightFailure['reason']): ExecutablePreflightOutcome =>
  Object.freeze({ reason, status: 'rejected' });

class ProbePreflightStory implements ExecutablePreflight {
  private readonly cleanupObserved = Promise.withResolvers<void>();
  private readonly probeStarted = Promise.withResolvers<void>();
  private readonly scenarios: ProbeScenario[] = [];
  private cleanupCompletion: PromiseWithResolvers<void> | undefined;
  private calls = 0;

  queue(scenario: ProbeScenario): void {
    this.scenarios.push(scenario);
  }

  callsCount(): number {
    return this.calls;
  }

  async waitForCleanup(): Promise<void> {
    await this.cleanupObserved.promise;
  }

  async waitForProbe(): Promise<void> {
    await this.probeStarted.promise;
  }

  confirmCleanup(): void {
    if (this.cleanupCompletion === undefined) throw new Error('Probe cleanup has not begun.');
    this.cleanupCompletion.resolve();
  }

  async probe(
    _definition: Parameters<ExecutablePreflight['probe']>[0],
    signal: AbortSignal,
  ): Promise<ExecutablePreflightOutcome> {
    this.calls += 1;
    this.probeStarted.resolve();
    const scenario = this.scenarios.shift();
    if (scenario === undefined) throw new Error('The probe story has no planned outcome.');
    if (scenario === 'available') return available();
    if (scenario === 'aborted') return aborted();
    if (scenario === 'throws') throw new Error('The executable preflight failed unexpectedly.');
    if (scenario !== 'pending') return rejected(scenario);
    if (signal.aborted) return aborted();

    const cleanup = Promise.withResolvers<void>();
    this.cleanupCompletion = cleanup;
    return new Promise((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          this.cleanupObserved.resolve();
          void cleanup.promise.then(() => resolve(aborted()));
        },
        { once: true },
      );
    });
  }
}

const probeDefinition = () =>
  agentDefinition({
    id: 'runtime-agent',
    launch: {
      args: [{ kind: 'literal', value: 'bridge.mjs' }],
      command: 'runtime-agent',
      versionProbe: { args: ['--version'], stream: 'stdout', timeoutMs: 1_000 },
    },
    version: '2.0.0',
  });

const startRequest = (agent: AgentRef): StartAgentInvocation => ({
  agent,
  invocationId: 'fresh-probe-before-start',
  output: { directory: '/fixture/probe-output' },
  parameters: {},
  permissions: {},
  prompt: 'Return a structured result.',
  result: { schema: { type: 'object' } },
  workspace: { directory: '/fixture/workspace' },
});

export interface AgentManagerProbeStory {
  readonly agent: AgentRef;
  readonly manager: ReturnType<typeof createAgentManager>;
  definitionDigest(): string;
  plan(scenario: ProbeScenario): void;
  probeCalls(): number;
  confirmCleanup(): void;
  start(): ReturnType<ReturnType<typeof createAgentManager>['start']>;
  waitForCleanup(): Promise<void>;
  waitForProbe(): Promise<void>;
}

export const agentManagerProbeStory = (): AgentManagerProbeStory => {
  const agent = Object.freeze({ id: 'runtime-agent', version: '2.0.0' });
  const preflight = new ProbePreflightStory();
  const manager = createAgentManager(
    managerOptions([probeDefinition()]),
    managerServices({ executablePreflight: preflight }),
  );
  const descriptor = manager.getAgent(agent);
  if (descriptor === undefined) throw new Error('The probe fixture definition is not registered.');

  return Object.freeze({
    agent,
    manager,
    confirmCleanup: () => preflight.confirmCleanup(),
    definitionDigest: () => descriptor.definitionDigest,
    plan: (scenario: ProbeScenario) => preflight.queue(scenario),
    probeCalls: () => preflight.callsCount(),
    start: () => manager.start(startRequest(agent)),
    waitForCleanup: () => preflight.waitForCleanup(),
    waitForProbe: () => preflight.waitForProbe(),
  });
};
