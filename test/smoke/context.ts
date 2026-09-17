import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  createAgentManager,
  discoverAgents,
  type ActiveInvocationStateSink,
  type AgentDefinitionInput,
  type AgentInvocationResult,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionTurnResult,
} from '../../src/index.js';
import { configurationForSessionSmoke, sessionSmokeCoverage } from './session/configuration.js';
import {
  authFailureCode,
  expectedInstructionsChannel,
  isAuthFailure,
  probePreflightLine,
} from './support/auth-preflight.js';
import {
  canonicalExecutableOnPath,
  formatCliIdentity,
  liveDiscoveryOptions,
  pinNodeRuntimeWithoutVendorShadow,
} from './support/cli-identity.js';
import { fakeAgentDefinition } from './support/fake-agent-definition.js';
import { knowledgeMcpSource } from './support/knowledge-mcp-source.js';
import {
  answerFixtureEchoPermissions,
  assertLivePath,
  authSourceLine,
  combinedInstructions,
  combinedInvocationPrompt,
  declaredAuthSource,
  fixtureOutputNames,
  invocationNonceObserved,
  invocationResultSchema,
  jsonOnlyInvocationPrompt,
  mcpOnlySessionPrompt,
  fixtureMcpEvidence,
  knowledgeMcpLaunchArgs,
  livePathVerdict,
  permissionRequested,
  readFixtureServerAudit,
  retainSafeLiveDiagnostic,
  sessionObserverSawTool,
  semanticResultRedacted,
  summarizeInvocationDiagnostics,
  summarizeInvocationFault,
  summarizeSessionDiagnostics,
  uniqueFixtureSecret,
  uniqueSessionId,
} from './support/live-context-evidence.js';
import { type BuiltInProviderId } from './support/provider-selection.js';

const selection = process.env.REVO_LIVE_CONTEXT_SMOKE;
const evidenceRoot = process.env.REVO_LIVE_CONTEXT_EVIDENCE_DIR;
const mcpToken = uniqueFixtureSecret();
const liveEnvironment = Object.freeze({
  inherit: Object.freeze(['HOME', 'PATH'].filter((name) => process.env[name] !== undefined)),
  secrets: Object.freeze({}),
  variables: Object.freeze({}),
});
const liveContext = Object.freeze({ environment: liveEnvironment });

const nonce = (): string => `nonce-${randomBytes(8).toString('hex')}`;

const knowledgeServer = (scriptPath: string, auditPath: string, correlationId: string) => ({
  args: knowledgeMcpLaunchArgs(scriptPath, auditPath, correlationId),
  command: process.execPath,
  env: { FIXTURE_MCP_TOKEN: { value: mcpToken } },
  name: 'knowledge',
  transport: 'stdio' as const,
});

const auditPathFor = (auditRoot: string, correlationId: string): string =>
  join(auditRoot, `${correlationId.replaceAll(/[^a-zA-Z0-9._-]+/g, '_')}.ndjson`);

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

const containsSecret = async (directory: string, names: readonly string[]): Promise<boolean> => {
  const texts = await Promise.all(
    names.map((name) => readFile(join(directory, name), 'utf8').catch(() => '')),
  );
  return texts.some((text) => text.includes(mcpToken));
};

const readOutputs = async (directory: string): Promise<string> => {
  const texts = await Promise.all(
    fixtureOutputNames.map((name) => readFile(join(directory, name), 'utf8').catch(() => '')),
  );
  return texts.join('\n');
};

const fileMissing = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => false,
    () => true,
  );

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const selectedLiveProviders = (value: string): readonly BuiltInProviderId[] => {
  if (value === 'all') return Object.freeze(['opencode', 'codex', 'grok']);
  if (value === 'opencode' || value === 'codex' || value === 'grok') return [value];
  throw new Error('REVO_LIVE_CONTEXT_SMOKE must be opencode, codex, grok, or all.');
};

const discoverSelected = async (provider: BuiltInProviderId) => {
  const vendorPath = pinNodeRuntimeWithoutVendorShadow(
    process.env.PATH ?? '',
    dirname(process.execPath),
  );
  const executable = canonicalExecutableOnPath(provider, vendorPath);
  const discovery = await discoverAgents(liveDiscoveryOptions(provider, executable));
  return discovery.definitions.find(({ id }) => id === `${provider}-acp`);
};

const createLiveManager = (
  definition: AgentDefinitionInput,
  events: AgentSessionEvent[],
  sink: ActiveInvocationStateSink,
) =>
  createAgentManager({
    activeStateSink: sink,
    definitions: [definition],
    sessions: {
      activeStateSink: {
        remove: async () => ({ state: 'applied' as const }),
        save: async () => ({ state: 'applied' as const }),
      },
      eventSink: {
        append: async (event) => {
          events.push(event);
          return { state: 'appended' as const };
        },
      },
    },
  });

const retainIfConfigured = async (
  label: string,
  directory: string,
  extra: {
    readonly assistantPreview?: string;
    readonly durationMs?: number;
    readonly fault: string;
    readonly phase: string;
    readonly serverAuditObserved: boolean;
    readonly serverAuditCorrelationId?: string;
    readonly serverAuditToolName?: string;
  },
): Promise<void> => {
  if (evidenceRoot === undefined || evidenceRoot.length === 0) return;
  const texts = await Promise.all(
    fixtureOutputNames.map((name) => readFile(join(directory, name), 'utf8').catch(() => '')),
  );
  const byName = Object.fromEntries(
    fixtureOutputNames.map((name, index) => [name, texts[index] ?? '']),
  );
  const retained = await retainSafeLiveDiagnostic(evidenceRoot, label, {
    assistantPreview:
      extra.assistantPreview ?? (byName['raw-final-response.txt'] || byName['result.json'] || ''),
    cleanup: 'confirmed',
    ...(extra.durationMs === undefined ? {} : { durationMs: extra.durationMs }),
    eventsText: byName['events.ndjson'] ?? '',
    fault: extra.fault,
    phase: extra.phase,
    resultText: byName['result.json'] ?? '',
    secrets: [mcpToken],
    serverAuditObserved: extra.serverAuditObserved,
    ...(extra.serverAuditCorrelationId === undefined
      ? {}
      : { serverAuditCorrelationId: extra.serverAuditCorrelationId }),
    ...(extra.serverAuditToolName === undefined
      ? {}
      : { serverAuditToolName: extra.serverAuditToolName }),
    stderrText: byName['stderr.log'] ?? '',
    stdoutText: byName['stdout.log'] ?? '',
  });
  console.log(`${label}: evidence=${retained}`);
};

const runFakeInvocation = async (
  directory: string,
  token: string,
  auditRoot: string,
): Promise<void> => {
  const state = recordingSink();
  const scriptPath = join(directory, 'knowledge-mcp.js');
  await writeFile(scriptPath, knowledgeMcpSource);
  const manager = createAgentManager({
    activeStateSink: state.sink,
    definitions: [fakeAgentDefinition('ok-result')],
  });
  try {
    await manager.initialize([]);
    const result = await (
      await manager.start({
        agent: { id: 'fake-acp', version: '1.0.0' },
        instructions: `Prefer terse answers. ${token}`,
        invocationId: 'fake-context-invocation',
        mcpServers: [
          knowledgeServer(
            scriptPath,
            auditPathFor(auditRoot, 'fake-context-invocation'),
            'fake-context-invocation',
          ),
        ],
        output: { directory: join(directory, 'fake-invocation') },
        parameters: {},
        permissions: {},
        prompt: 'Return the fake result.',
        result: { schema: { type: 'object' } },
        workspace: { directory },
      })
    ).result();
    if (result.status !== 'succeeded')
      throw new Error(`Fake context invocation ended with ${result.status}.`);
    if (result.instructionsDelivery?.channel !== 'acp:session/prompt.prefix')
      throw new Error('Fake context invocation did not report prefix delivery.');
    if (state.activeIds.size !== 0) throw new Error('Fake context invocation left active state.');
    if (await containsSecret(result.files.directory, ['stdout.log', 'stderr.log', 'result.json']))
      throw new Error('Fake context invocation leaked the MCP fixture token.');
    console.log(
      `fake-acp: path=invocation; delivery=${result.instructionsDelivery.channel}; cleanup=confirmed; secretRedacted=true`,
    );
  } finally {
    await manager.shutdown();
  }
};

const summarizeInvocation = (
  name: string,
  result: AgentInvocationResult,
  expected: string,
  nonceSeen: boolean,
  toolSeen: boolean,
): string => {
  const delivery = result.instructionsDelivery?.channel ?? 'omitted';
  return [
    `${name}: path=invocation; status=${result.status}`,
    `fault=${summarizeInvocationFault(result)}`,
    `delivery=${delivery}`,
    `expected=${expected}`,
    `deliveryMatched=${delivery === expected}`,
    `nonceEchoed=${nonceSeen}`,
    `tool=${toolSeen ? 'observed' : 'missing'}`,
    'cleanup=confirmed',
  ].join('; ');
};

const awaitSessionTurn = async (
  session: AgentSession,
  events: readonly AgentSessionEvent[],
  prompt: string,
  turnId: string,
): Promise<AgentSessionTurnResult> => {
  const turn = await session.send({ prompt, turnId });
  const pending = turn.result();
  const answered = new Set<string>();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- permission requests must be answered while the turn is running
    await answerFixtureEchoPermissions(session, events, answered);
    // oxlint-disable-next-line no-await-in-loop -- poll the in-flight turn without blocking permission answers
    const settled = await Promise.race([
      pending.then((result) => ({ result, status: 'done' as const })),
      delay(25).then(() => ({ status: 'wait' as const })),
    ]);
    if (settled.status === 'done') {
      // oxlint-disable-next-line no-await-in-loop -- drain any permission that arrived with the terminal result
      await answerFixtureEchoPermissions(session, events, answered);
      return settled.result;
    }
  }
};

const runJsonOnlyProbe = async (
  definition: AgentDefinitionInput,
  directory: string,
  instructions: string,
  instructionNonce: string,
  configuration: ReturnType<typeof configurationForSessionSmoke>,
  expected: string,
): Promise<void> => {
  const state = recordingSink();
  const manager = createLiveManager(definition, [], state.sink);
  try {
    await manager.initialize({ invocations: [], sessions: [] });
    const result = await (
      await manager.start(
        {
          agent: { id: definition.id, version: definition.version },
          configuration,
          instructions,
          invocationId: `${definition.id}-json-only`,
          limits: { idleTimeoutMs: 120_000, wallClockTimeoutMs: 180_000 },
          output: { directory: join(directory, `${definition.id}-json-only`) },
          parameters: {},
          permissions: {},
          prompt: jsonOnlyInvocationPrompt(),
          result: { schema: invocationResultSchema },
          workspace: { directory },
        },
        liveContext,
      )
    ).result();
    const outputs = await readOutputs(result.files.directory);
    console.log(
      `${definition.id}: probe=json-only; coverage=default-model; ${summarizeInvocationDiagnostics(result)}; nonce=${invocationNonceObserved(result, outputs, instructionNonce)}; delivery=${result.instructionsDelivery?.channel ?? 'omitted'}; expected=${expected}`,
    );
    await retainIfConfigured(`${definition.id}-json-only`, result.files.directory, {
      durationMs: result.durationMs,
      fault: summarizeInvocationFault(result),
      phase: 'json-only',
      serverAuditObserved: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.log(
      `${definition.id}: probe=json-only; coverage=default-model; status=failed; reason=${message.slice(0, 160)}`,
    );
  } finally {
    await manager.shutdown();
  }
};

const runMcpOnlySessionProbe = async (
  definition: AgentDefinitionInput,
  directory: string,
  instructions: string,
  instructionNonce: string,
  configuration: ReturnType<typeof configurationForSessionSmoke>,
  expected: string,
  scriptPath: string,
  runNonce: string,
  auditRoot: string,
): Promise<void> => {
  const events: AgentSessionEvent[] = [];
  const state = recordingSink();
  const manager = createLiveManager(definition, events, state.sink);
  const correlationId = uniqueSessionId(definition.id, `${runNonce}-mcp`);
  const auditPath = auditPathFor(auditRoot, correlationId);
  try {
    await manager.initialize({ invocations: [], sessions: [] });
    const session = await manager.sessions.open(
      {
        agent: { id: definition.id, version: definition.version },
        configuration,
        instructions,
        limits: { idleTimeoutMs: 120_000, wallClockTimeoutMs: 180_000 },
        mcpServers: [knowledgeServer(scriptPath, auditPath, correlationId)],
        output: { directory: join(directory, `${definition.id}-mcp-only`) },
        parameters: {},
        permissions: {},
        sessionId: correlationId,
        workspace: { directory },
      },
      liveContext,
    );
    const first = await awaitSessionTurn(session, events, mcpOnlySessionPrompt(), 'trn_mcp_only');
    const snapshot = manager.sessions.inspect(session.sessionId);
    const sessionText = [
      first.status === 'completed' ? first.message.content : '',
      ...events.map((event) =>
        event.type === 'tool.activity'
          ? `${event.title} ${event.kind} ${event.status}`
          : event.type,
      ),
    ].join('\n');
    const audit = await readFixtureServerAudit(auditPath);
    const toolObserved = fixtureMcpEvidence({
      audit,
      correlationId,
      events,
      nonce: instructionNonce,
      outputs: sessionText,
    });
    console.log(
      `${definition.id}: probe=mcp-only-session; ${summarizeSessionDiagnostics(first, snapshot?.status)}; nonce=${first.status === 'completed' && first.message.content.includes(instructionNonce)}; tool=${toolObserved ? 'echo' : 'missing'}; observer=${sessionObserverSawTool(events) ? 'tool.activity' : 'none'}; permission=${permissionRequested(events) ? 'blocked' : 'none'}; delivery=${events.find((event) => event.type === 'session.opened')?.type === 'session.opened' ? events.find((event) => event.type === 'session.opened') && 'opened' : 'omitted'}; expected=${expected}`,
    );
    await session.close('mcp-only probe complete');
    await retainIfConfigured(
      `${definition.id}-mcp-only`,
      join(directory, `${definition.id}-mcp-only`),
      {
        assistantPreview: first.status === 'completed' ? first.message.content.slice(0, 1_024) : '',
        fault: summarizeSessionDiagnostics(first, snapshot?.status),
        phase: 'mcp-only-session',
        serverAuditCorrelationId: correlationId,
        serverAuditObserved: toolObserved,
        ...(toolObserved ? { serverAuditToolName: 'echo' } : {}),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.log(
      `${definition.id}: probe=mcp-only-session; status=failed; reason=${message.slice(0, 160)}`,
    );
  } finally {
    await manager.shutdown();
  }
};

const runLiveProvider = async (
  definition: AgentDefinitionInput,
  directory: string,
  auditRoot: string,
): Promise<'passed' | 'blocked' | 'auth_failed' | 'failed'> => {
  const instructionNonce = nonce();
  const runNonce = nonce();
  const instructions = combinedInstructions(instructionNonce);
  const invocationState = recordingSink();
  const sessionState = recordingSink();
  const scriptPath = join(directory, 'knowledge-mcp.js');
  await writeFile(scriptPath, knowledgeMcpSource);
  const invocationEvents: AgentSessionEvent[] = [];
  const sessionEvents: AgentSessionEvent[] = [];
  const manager = createLiveManager(definition, invocationEvents, invocationState.sink);
  const invocationCorrelation = `${definition.id}-context-invocation`;
  const sessionCorrelation = uniqueSessionId(definition.id, runNonce);
  const invocationAuditPath = auditPathFor(auditRoot, invocationCorrelation);
  const sessionAuditPath = auditPathFor(auditRoot, sessionCorrelation);
  try {
    await manager.initialize({ invocations: [], sessions: [] });
    const probe = await manager.probeAgent({ id: definition.id, version: definition.version });
    console.log(probePreflightLine(definition.id, probe));
    if (probe.status !== 'available') return 'blocked';
    const expected = expectedInstructionsChannel(definition.id, probe.reportedVersion);
    console.log(
      formatCliIdentity(
        definition.id,
        probe.versionProbeExecutable ?? probe.executable,
        probe.reportedVersion ?? 'none',
      ),
    );
    let catalog;
    try {
      catalog = await manager.inspectConfiguration(
        {
          agent: { id: definition.id, version: definition.version },
          workspace: { directory },
        },
        liveContext,
      );
    } catch (error) {
      if (isAuthFailure(error)) {
        console.log(`${definition.id}: preflight=auth_failed; code=${authFailureCode(error)}`);
        return 'auth_failed';
      }
      const code =
        authFailureCode(error) !== 'unknown'
          ? authFailureCode(error)
          : error instanceof Error
            ? error.name
            : 'unknown';
      console.log(`${definition.id}: preflight=blocked; inspect=${code}`);
      return 'blocked';
    }
    const models = catalog.model?.sessionAvailable.length ?? 0;
    console.log(
      authSourceLine(
        definition.id,
        liveEnvironment.inherit,
        models,
        declaredAuthSource(process.env.REVO_LIVE_AUTH_SOURCE),
      ),
    );
    console.log(`${definition.id}: preflight=ready; expected=${expected}`);
    let configuration;
    let defaultModelConfiguration;
    try {
      const coverage = sessionSmokeCoverage(catalog, definition.id);
      console.log(
        `${definition.id}: coverage=${coverage.default.label}; model=${String(coverage.default.configuration.selections.model ?? 'omitted')}`,
      );
      console.log(
        `${definition.id}: coverage=${coverage.selected.label}; model=${String(coverage.selected.configuration.selections.model ?? 'omitted')}`,
      );
      configuration = coverage.selected.configuration;
      defaultModelConfiguration = coverage.default.configuration;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      console.log(`${definition.id}: preflight=blocked; configuration=${message.slice(0, 160)}`);
      return 'blocked';
    }
    const invocation = await (
      await manager.start(
        {
          agent: { id: definition.id, version: definition.version },
          configuration,
          instructions,
          invocationId: `${definition.id}-context-invocation`,
          limits: { idleTimeoutMs: 120_000, wallClockTimeoutMs: 180_000 },
          mcpServers: [knowledgeServer(scriptPath, invocationAuditPath, invocationCorrelation)],
          output: { directory: join(directory, `${definition.id}-invocation`) },
          parameters: {},
          permissions: {},
          prompt: combinedInvocationPrompt(),
          result: { schema: invocationResultSchema },
          workspace: { directory },
        },
        liveContext,
      )
    ).result();
    if (invocation.status === 'failed' && isAuthFailure(invocation.error)) {
      console.log(`${definition.id}: invocation=auth_failed; code=${invocation.error.code}`);
      return 'auth_failed';
    }
    const leaked = await containsSecret(invocation.files.directory, [
      'events.ndjson',
      'stdout.log',
      'stderr.log',
      'result.json',
    ]);
    if (leaked) throw new Error('Live invocation leaked the MCP fixture token.');
    const invocationOutputs = await readOutputs(invocation.files.directory);
    const invocationNonce = invocationNonceObserved(
      invocation,
      invocationOutputs,
      instructionNonce,
    );
    if (semanticResultRedacted(invocation))
      throw new Error('Live invocation semantic result contained unexpected REDACTED.');
    const invocationAudit = await readFixtureServerAudit(invocationAuditPath);
    const invocationTool = fixtureMcpEvidence({
      audit: invocationAudit,
      correlationId: invocationCorrelation,
      events: invocationEvents,
      nonce: instructionNonce,
      outputs: invocationOutputs,
    });
    const invocationPermission = permissionRequested(invocationEvents);
    console.log(
      summarizeInvocation(definition.id, invocation, expected, invocationNonce, invocationTool),
    );
    console.log(`${definition.id}: ${summarizeInvocationDiagnostics(invocation)}`);
    await retainIfConfigured(`${definition.id}-invocation`, invocation.files.directory, {
      durationMs: invocation.durationMs,
      fault: summarizeInvocationFault(invocation),
      phase: 'invocation',
      serverAuditCorrelationId: invocationCorrelation,
      serverAuditObserved: invocationTool,
      ...(invocationTool ? { serverAuditToolName: 'echo' } : {}),
    });
    if (invocationState.activeIds.size !== 0) throw new Error('Live invocation left active state.');
    if (
      expected === 'opencode:config.instructions-file' &&
      !(await fileMissing(join(invocation.files.directory, 'revo-opencode-instructions.md')))
    )
      throw new Error('OpenCode instructions file remained after teardown.');

    await manager.shutdown();
    const sessionManager = createLiveManager(definition, sessionEvents, sessionState.sink);
    await sessionManager.initialize({ invocations: [], sessions: [] });
    try {
      if (!sessionManager.sessions.listAgents().some(({ agent }) => agent.id === definition.id)) {
        console.log(`${definition.id}: path=session; status=skipped; reason=session_unsupported`);
        throw new Error('Live context requires a session path.');
      }
      const session = await sessionManager.sessions.open(
        {
          agent: { id: definition.id, version: definition.version },
          configuration,
          instructions,
          limits: { idleTimeoutMs: 120_000, wallClockTimeoutMs: 180_000 },
          mcpServers: [knowledgeServer(scriptPath, sessionAuditPath, sessionCorrelation)],
          output: { directory: join(directory, `${definition.id}-session`) },
          parameters: {},
          permissions: {},
          sessionId: sessionCorrelation,
          workspace: { directory },
        },
        liveContext,
      );
      const opened = sessionEvents.find((event) => event.type === 'session.opened');
      const sessionDelivery =
        opened?.type === 'session.opened' ? opened.instructionsDelivery?.channel : undefined;
      const first = await awaitSessionTurn(
        session,
        sessionEvents,
        mcpOnlySessionPrompt(),
        'trn_context',
      );
      const snapshot = sessionManager.sessions.inspect(session.sessionId);
      console.log(`${definition.id}: ${summarizeSessionDiagnostics(first, snapshot?.status)}`);
      await session.close('context smoke complete');
      const sessionText = [
        first.status === 'completed' ? first.message.content : '',
        ...sessionEvents.map((event) =>
          event.type === 'tool.activity'
            ? `${event.title} ${event.kind} ${event.status}`
            : event.type === 'assistant.message.delta'
              ? event.content
              : event.type,
        ),
      ].join('\n');
      const sessionAudit = await readFixtureServerAudit(sessionAuditPath);
      const sessionTool = fixtureMcpEvidence({
        audit: sessionAudit,
        correlationId: sessionCorrelation,
        events: sessionEvents,
        nonce: instructionNonce,
        outputs: sessionText,
      });
      const sessionPermission = permissionRequested(sessionEvents);
      const nonceMatched =
        first.status === 'completed' && first.message.content.includes(instructionNonce);
      if (sessionState.activeIds.size !== 0)
        throw new Error('Live session left invocation active state.');
      console.log(
        [
          `${definition.id}: path=session; status=${first.status}`,
          `delivery=${sessionDelivery ?? 'omitted'}`,
          `expected=${expected}`,
          `deliveryMatched=${sessionDelivery === expected}`,
          `nonceMatched=${nonceMatched}`,
          `tool=${sessionTool ? 'observed' : 'missing'}`,
          `observer=${sessionObserverSawTool(sessionEvents) ? 'tool.activity' : 'none'}`,
          `permission=${sessionPermission || invocationPermission ? 'blocked' : 'none'}`,
          'cleanup=confirmed',
        ].join('; '),
      );
      await retainIfConfigured(
        `${definition.id}-session`,
        join(directory, `${definition.id}-session`),
        {
          assistantPreview:
            first.status === 'completed' ? first.message.content.slice(0, 1_024) : '',
          fault: summarizeSessionDiagnostics(first, snapshot?.status),
          phase: 'session',
          serverAuditCorrelationId: sessionCorrelation,
          serverAuditObserved: sessionTool,
          ...(sessionTool ? { serverAuditToolName: 'echo' } : {}),
        },
      );
      if (first.status === 'failed' && isAuthFailure(first.error)) return 'auth_failed';
      try {
        await runJsonOnlyProbe(
          definition,
          directory,
          instructions,
          instructionNonce,
          defaultModelConfiguration,
          expected,
        );
        await runMcpOnlySessionProbe(
          definition,
          directory,
          instructions,
          instructionNonce,
          configuration,
          expected,
          scriptPath,
          runNonce,
          auditRoot,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        console.log(
          `${definition.id}: probe=additional; status=failed; reason=${message.slice(0, 160)}`,
        );
      }
      const invocationEvidence = {
        delivery: invocation.instructionsDelivery?.channel ?? 'omitted',
        expected,
        ...(invocation.status === 'failed' || invocation.status === 'timed_out'
          ? { faultCode: invocation.error.code, faultPhase: invocation.error.phase }
          : {}),
        nonceObserved: invocationNonce,
        permissionRequested: invocationPermission,
        status: invocation.status,
        toolObserved: invocationTool,
      };
      const sessionEvidence = {
        delivery: sessionDelivery ?? 'omitted',
        expected,
        nonceObserved: nonceMatched,
        permissionRequested: sessionPermission,
        status: first.status,
        toolObserved: sessionTool,
      };
      const invocationVerdict = livePathVerdict('invocation', invocationEvidence);
      const sessionVerdict = livePathVerdict('session', sessionEvidence);
      if (invocationVerdict === 'blocked' || sessionVerdict === 'blocked') {
        console.log(`${definition.id}: status=blocked; reason=permission-required`);
        return 'blocked';
      }
      assertLivePath('invocation', invocationEvidence);
      assertLivePath('session', sessionEvidence);
      return 'passed';
    } finally {
      await sessionManager.shutdown();
    }
  } catch (error) {
    if (isAuthFailure(error)) {
      console.log(`${definition.id}: status=auth_failed; code=${authFailureCode(error)}`);
      return 'auth_failed';
    }
    throw error;
  } finally {
    await manager.shutdown();
  }
};

const directory = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-context-smoke-'));
const auditRoot = await mkdtemp(join(tmpdir(), 'revo-agent-runtime-context-audit-'));
await chmod(auditRoot, 0o700);

try {
  console.log('smoke:context');
  await runFakeInvocation(directory, nonce(), auditRoot);
  if (selection === undefined) process.exitCode = 0;
  else {
    let failed = false;
    for (const provider of selectedLiveProviders(selection)) {
      // oxlint-disable-next-line no-await-in-loop -- live providers run sequentially to isolate process and account state
      const definition = await discoverSelected(provider);
      if (definition === undefined) {
        console.log(`${provider}-acp: status=blocked; reason=executable_unavailable`);
        failed = true;
        continue;
      }
      try {
        // oxlint-disable-next-line no-await-in-loop -- each provider must finish cleanup before the next starts
        const outcome = await runLiveProvider(definition, directory, auditRoot);
        if (outcome === 'auth_failed') {
          console.log(`${definition.id}: stopped after auth failure; no login fallback`);
          failed = true;
          continue;
        }
        if (outcome !== 'passed') failed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        console.log(`${definition.id}: status=failed; reason=${message.slice(0, 160)}`);
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  }
} finally {
  await rm(directory, { force: true, recursive: true });
  await rm(auditRoot, { force: true, recursive: true });
}
