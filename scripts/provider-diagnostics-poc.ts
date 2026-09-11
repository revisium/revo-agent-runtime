import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAgentManager,
  discoverAgents,
  type AgentConfigurationCatalog,
  type AgentConfigurationSelection,
  type AgentDefinitionInput,
} from '../src/index.js';
import {
  captureProviderDiagnostics,
  type ProviderDiagnosticTrace,
} from '../test/smoke/support/provider-diagnostics.js';

type MatrixCase = Readonly<{
  id: string;
  agentId: string;
  selection?: {
    readonly strategy?: 'fresh-catalog-defaults';
    readonly overrides?: Readonly<Record<string, string | boolean>>;
    readonly requireAdvertisedInFreshCatalog?: boolean;
  };
  prompt?: string;
  maxPromptTurns?: number;
  maxDurationMs?: number;
  authPolicy?: string;
  credentialScope?: string;
  stopOnAuthFailure?: string;
}>;
type Matrix = Readonly<{
  cases: readonly MatrixCase[];
  execution?: Readonly<{
    readonly maxActualPromptTurns?: number;
    readonly maxDurationMsPerCase?: number;
    readonly retries?: number;
  }>;
}>;
type TransportCapture = ProviderDiagnosticTrace & {
  readonly child?: { readonly code: number | null; readonly signal: string | null };
  readonly wrapper?: { readonly code: number | null; readonly signal: string | null };
};

type CleanupReport = Readonly<{
  session: 'completed' | 'timed_out' | 'not_started' | 'failed';
  manager: 'completed' | 'timed_out' | 'not_started' | 'failed';
}>;

const wrapper = fileURLToPath(new URL('./provider-diagnostics-wrapper.mjs', import.meta.url));
const runtimeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirtySourceDigest = createHash('sha256')
  .update(execFileSync('git', ['diff', 'HEAD'], { encoding: 'buffer' }))
  .digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const packageJson: unknown = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const runtimePackage =
  isRecord(packageJson) && typeof packageJson.version === 'string'
    ? { version: packageJson.version }
    : {};
const invocationStateSink = Object.freeze({ remove: async () => {}, save: async () => {} });
const sessionStateSink = Object.freeze({
  remove: async () => ({ state: 'applied' as const }),
  save: async () => ({ state: 'applied' as const }),
});
const environment = Object.freeze({
  inherit: Object.freeze(['HOME', 'PATH']),
  secrets: Object.freeze({}),
  variables: Object.freeze({}),
});

const literalLaunchArguments = (definition: AgentDefinitionInput): readonly string[] => {
  const values: string[] = [];
  for (const argument of definition.launch.args) {
    if (argument.kind !== 'literal')
      throw new Error(`Non-literal launch argument: ${definition.id}`);
    values.push(argument.value);
  }
  return values;
};

const launchWithWrapper = (
  definition: AgentDefinitionInput,
  capture: string,
): AgentDefinitionInput => {
  const command = definition.launch.command;
  const args = literalLaunchArguments(definition);
  return {
    ...definition,
    launch: {
      ...definition.launch,
      args: [
        { kind: 'literal', value: wrapper },
        { kind: 'literal', value: command },
        ...args.map((value) => ({ kind: 'literal' as const, value })),
        { kind: 'literal', value: '--capture' },
        { kind: 'literal', value: capture },
      ],
      command: process.execPath,
      versionProbe: {
        ...definition.launch.versionProbe,
        command: definition.launch.versionProbe.command ?? command,
      },
    },
  };
};

const selectionFor = (
  catalog: AgentConfigurationCatalog,
  overrides: Readonly<Record<string, string | boolean>> = {},
): AgentConfigurationSelection => {
  const selections: Record<string, string | boolean> = {};
  for (const option of catalog.options) {
    const override = overrides[option.id];
    if (override !== undefined) {
      if (option.type === 'boolean' && typeof override !== 'boolean')
        throw new Error(`Boolean override is invalid: ${option.id}`);
      if (
        option.type === 'select' &&
        (typeof override !== 'string' || !option.values.some(({ value }) => value === override))
      )
        throw new Error(`Selection is not advertised: ${option.id}`);
      selections[option.id] = override;
    } else selections[option.id] = option.currentValue;
  }
  for (const key of Object.keys(overrides))
    if (!catalog.options.some((option) => option.id === key))
      throw new Error(`Unknown selection: ${key}`);
  return { catalogRevision: catalog.catalogRevision, selections };
};

const readMatrix = async (path: string): Promise<Matrix> => {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.cases)) throw new Error('Matrix has no cases.');
  const rawCases: readonly unknown[] = raw.cases;
  const cases: MatrixCase[] = rawCases.map((candidate: unknown): MatrixCase => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.agentId !== 'string'
    )
      throw new Error('Matrix case identity is required.');
    const selection = isRecord(candidate.selection) ? candidate.selection : undefined;
    const rawOverrides =
      selection !== undefined && isRecord(selection.overrides) ? selection.overrides : undefined;
    const overrides =
      rawOverrides === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(rawOverrides).map(([key, value]) => {
              if (typeof value !== 'string' && typeof value !== 'boolean')
                throw new Error(`Invalid selection value: ${key}`);
              return [key, value];
            }),
          );
    return {
      agentId: candidate.agentId,
      id: candidate.id,
      ...(typeof candidate.maxDurationMs === 'number'
        ? { maxDurationMs: candidate.maxDurationMs }
        : {}),
      ...(typeof candidate.maxPromptTurns === 'number'
        ? { maxPromptTurns: candidate.maxPromptTurns }
        : {}),
      ...(typeof candidate.prompt === 'string' ? { prompt: candidate.prompt } : {}),
      ...(typeof candidate.authPolicy === 'string' ? { authPolicy: candidate.authPolicy } : {}),
      ...(typeof candidate.credentialScope === 'string'
        ? { credentialScope: candidate.credentialScope }
        : {}),
      ...(typeof candidate.stopOnAuthFailure === 'string'
        ? { stopOnAuthFailure: candidate.stopOnAuthFailure }
        : {}),
      ...(selection === undefined && overrides === undefined
        ? {}
        : { selection: { ...(overrides === undefined ? {} : { overrides }) } }),
    };
  });
  const matrix: Matrix = {
    cases,
    ...(isRecord(raw.execution)
      ? {
          execution: {
            ...(typeof raw.execution.maxActualPromptTurns === 'number'
              ? { maxActualPromptTurns: raw.execution.maxActualPromptTurns }
              : {}),
            ...(typeof raw.execution.maxDurationMsPerCase === 'number'
              ? { maxDurationMsPerCase: raw.execution.maxDurationMsPerCase }
              : {}),
            ...(typeof raw.execution.retries === 'number'
              ? { retries: raw.execution.retries }
              : {}),
          },
        }
      : {}),
  };
  if (matrix.cases.length === 0) throw new Error('Matrix has no cases.');
  const execution = matrix.execution ?? {};
  if ((execution.retries ?? 0) !== 0) throw new Error('Retries are prohibited.');
  const maxPrompts = execution.maxActualPromptTurns ?? 5;
  const prompts = matrix.cases.reduce(
    (total, candidate) => total + (candidate.maxPromptTurns ?? 0),
    0,
  );
  if (prompts > maxPrompts || prompts > 5) throw new Error('Matrix exceeds the prompt limit.');
  for (const candidate of matrix.cases) {
    if (!candidate.id || !candidate.agentId) throw new Error('Matrix case identity is required.');
    const duration = candidate.maxDurationMs ?? execution.maxDurationMsPerCase ?? 90_000;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 90_000)
      throw new Error(`Case duration exceeds 90 seconds: ${candidate.id}`);
    if ((candidate.maxPromptTurns ?? 0) < 0 || (candidate.maxPromptTurns ?? 0) > 5)
      throw new Error(`Invalid prompt count: ${candidate.id}`);
  }
  return matrix;
};

const readTransport = async (path: string): Promise<TransportCapture> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(value)) throw new Error('Invalid transport capture.');
  const processExit = (candidate: unknown) => {
    if (!isRecord(candidate)) return undefined;
    const code = candidate.code;
    const signal = candidate.signal;
    if (
      (typeof code !== 'number' && code !== null) ||
      (typeof signal !== 'string' && signal !== null)
    )
      return undefined;
    return { code, signal };
  };
  const child = processExit(value.child);
  const wrapperExit = processExit(value.wrapper);
  const transport: TransportCapture = {
    ...(Array.isArray(value.outbound) ? { outbound: value.outbound.filter(isRecord) } : {}),
    ...(Array.isArray(value.stderr)
      ? { stderr: value.stderr.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(child === undefined ? {} : { child }),
    ...(wrapperExit === undefined ? {} : { wrapper: wrapperExit }),
  };
  return transport;
};

const withDeadline = async <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) throw new Error('case_deadline_exceeded');
  return await new Promise<T>((fulfill, reject) => {
    const onAbort = () => reject(new Error('case_deadline_exceeded'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        fulfill(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

const cleanupWithDeadline = async (
  operation: () => Promise<void>,
  timeoutMs = 5_000,
): Promise<'completed' | 'timed_out' | 'failed'> => {
  const timeout = new Promise<'timed_out'>((fulfill) => {
    setTimeout(() => fulfill('timed_out'), timeoutMs).unref();
  });
  try {
    const result = await Promise.race([operation().then(() => 'completed' as const), timeout]);
    return result;
  } catch {
    return 'failed';
  }
};

const diagnosticTrace = (transport: TransportCapture): ProviderDiagnosticTrace => ({
  ...(transport.outbound === undefined ? {} : { outbound: transport.outbound }),
  ...(transport.stderr === undefined ? {} : { stderr: transport.stderr }),
  exited: transport.child !== undefined,
  ...(transport.child === undefined
    ? {}
    : { exitCode: transport.child.code, exitSignal: transport.child.signal }),
  closeReceived: transport.wrapper !== undefined,
});

const atomicWrite = async (path: string, value: unknown): Promise<void> => {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
};

const outputDirectory = (root: string, caseId: string): string =>
  join(root, `${caseId}-session-output`);

const publicOutcome = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) return { type: typeof value };
  const exit = isRecord(value.exit) ? value.exit : undefined;
  const error = isRecord(value.error) ? value.error : undefined;
  return {
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(exit !== undefined
      ? {
          exit: {
            ...(typeof exit.code === 'number' || exit.code === null ? { code: exit.code } : {}),
            ...(typeof exit.signal === 'string' || exit.signal === null
              ? { signal: exit.signal }
              : {}),
          },
        }
      : {}),
    ...(error !== undefined
      ? {
          error: {
            ...(typeof error.code === 'string' ? { code: error.code } : {}),
            ...(typeof error.phase === 'string' ? { phase: error.phase } : {}),
            ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
          },
        }
      : {}),
  };
};

const runCase = async (root: string, candidate: MatrixCase): Promise<unknown> => {
  const duration = candidate.maxDurationMs ?? 90_000;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), duration);
  deadlineTimer.unref();
  const context = { environment, signal: deadlineController.signal };
  let discovered: Awaited<ReturnType<typeof discoverAgents>>;
  try {
    discovered = await withDeadline(discoverAgents(), deadlineController.signal);
  } catch (error) {
    clearTimeout(deadlineTimer);
    return {
      caseId: candidate.id,
      phase: 'discovery',
      status: 'failed',
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: typeof error },
      authPolicy: candidate.authPolicy,
      credentialScope: candidate.credentialScope,
    };
  }
  const original = discovered.definitions.find(({ id }) => id === candidate.agentId);
  if (original === undefined) {
    clearTimeout(deadlineTimer);
    return { caseId: candidate.id, status: 'blocked', reason: 'agent_not_discovered' };
  }
  const captureFile = join(root, `${candidate.id}.transport.json`);
  const definition = launchWithWrapper(original, captureFile);
  const workspace = join(root, `${candidate.id}-workspace`);
  await mkdir(workspace, { recursive: true });
  const manager = createAgentManager({
    activeStateSink: invocationStateSink,
    definitions: [definition],
    limits: { idleTimeoutMs: 90_000, wallClockTimeoutMs: candidate.maxDurationMs ?? 90_000 },
    sessions: {
      activeStateSink: sessionStateSink,
      eventSink: { append: async () => ({ state: 'appended' as const }) },
      limits: { maxActiveSessions: 1 },
    },
  });
  const base = {
    agent: { id: original.id, version: original.version },
    caseId: candidate.id,
    runtime: {
      dirtySourceDigest,
      revision: runtimeRevision,
      version: runtimePackage.version ?? 'unknown',
    },
    wrapped: { command: process.execPath, wrapper },
  };
  let session: Awaited<ReturnType<typeof manager.sessions.open>> | undefined;
  let actualResult: unknown;
  let outcome: Record<string, unknown> = { ...base, status: 'failed' };
  let resolvedSelections: AgentConfigurationSelection['selections'] | undefined;
  let cleanup: CleanupReport = { session: 'not_started', manager: 'not_started' };
  let phase: 'inspect' | 'open' | 'prompt' | 'close' = 'inspect';
  try {
    await withDeadline(
      manager.initialize({ invocations: [], sessions: [] }),
      deadlineController.signal,
    );
    const catalog = await withDeadline(
      manager.inspectConfiguration(
        {
          agent: { id: definition.id, version: definition.version },
          workspace: { directory: workspace },
        },
        context,
      ),
      deadlineController.signal,
    );
    const selection = selectionFor(catalog, candidate.selection?.overrides);
    resolvedSelections = selection.selections;
    const prompts = candidate.maxPromptTurns ?? 0;
    if (prompts === 0) {
      outcome = {
        ...base,
        catalog: {
          launch: catalog.launch,
          revision: catalog.catalogRevision,
          optionCount: catalog.options.length,
        },
        definitionDigest: catalog.definitionDigest,
        phase: 'inspect',
        status: 'inspected',
        authPolicy: candidate.authPolicy,
        credentialScope: candidate.credentialScope,
      };
    } else {
      phase = 'open';
      session = await withDeadline(
        manager.sessions.open(
          {
            agent: { id: definition.id, version: definition.version },
            configuration: selection,
            limits: { idleTimeoutMs: duration, wallClockTimeoutMs: duration },
            output: { directory: outputDirectory(root, candidate.id) },
            parameters: {},
            permissions: {},
            sessionId: `${candidate.id}-session`,
            workspace: { directory: workspace },
          },
          context,
        ),
        deadlineController.signal,
      );
      phase = 'prompt';
      const openedSession = session;
      const turn = await withDeadline(
        openedSession.send(
          {
            prompt:
              candidate.prompt ?? 'Do not use tools or read or write files. Reply only with pong.',
            turnId: `${candidate.id}-turn-1`,
          },
          context,
        ),
        deadlineController.signal,
      );
      const result = await withDeadline(turn.result(), deadlineController.signal);
      actualResult = result;
      const definitionDigest = openedSession.pin.definitionDigest;
      outcome = {
        ...base,
        catalog: {
          launch: catalog.launch,
          revision: catalog.catalogRevision,
          selectedModel:
            typeof selection.selections.model === 'string' ? selection.selections.model : undefined,
          optionCount: catalog.options.length,
        },
        definitionDigest,
        phase: 'result',
        publicOutcome: publicOutcome(result),
        status: result.status,
        authPolicy: candidate.authPolicy,
        credentialScope: candidate.credentialScope,
      };
    }
  } catch (error) {
    const fault = isRecord(error) && isRecord(error.fault) ? error.fault : undefined;
    const runtimeError =
      fault !== undefined &&
      typeof fault.code === 'string' &&
      typeof fault.message === 'string' &&
      typeof fault.phase === 'string' &&
      typeof fault.retryable === 'boolean'
        ? {
            code: fault.code,
            message: fault.message,
            phase: fault.phase,
            retryable: fault.retryable,
            ...(fault.details === undefined ? {} : { details: fault.details }),
          }
        : error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: typeof error };
    actualResult = {
      error: runtimeError,
    };
    outcome = {
      ...base,
      error: runtimeError,
      phase,
      status: 'failed',
      authPolicy: candidate.authPolicy,
      credentialScope: candidate.credentialScope,
    };
  } finally {
    const diagnosticPhase = phase;
    phase = 'close';
    try {
      cleanup = {
        session:
          session === undefined
            ? 'not_started'
            : await cleanupWithDeadline(async () => {
                await session!.close('provider diagnostics case complete');
              }),
        manager: await cleanupWithDeadline(() =>
          manager.shutdown('provider diagnostics case complete'),
        ),
      };
    } finally {
      const transport = await readTransport(captureFile).catch(() => undefined);
      if (transport !== undefined) {
        const diagnostic = captureProviderDiagnostics({
          agent: original,
          caseId: candidate.id,
          phase: diagnosticPhase,
          publicResult: actualResult,
          trace: diagnosticTrace(transport),
          ...(typeof resolvedSelections?.model === 'string'
            ? { model: resolvedSelections.model }
            : {}),
          ...(resolvedSelections === undefined ? {} : { selections: resolvedSelections }),
        });
        outcome.diagnostic = diagnostic;
        outcome.transport = { child: transport.child, wrapper: transport.wrapper };
      }
      outcome.cleanup = cleanup;
    }
    clearTimeout(deadlineTimer);
  }
  return outcome;
};

const matrixPath = process.argv[2];
const outputRoot = resolve(process.argv[3] ?? join(tmpdir(), 'revo-provider-error-poc'));
if (matrixPath === undefined)
  throw new Error(
    'Usage: pnpm tsx scripts/provider-diagnostics-poc.ts <matrix.json> [output-directory]',
  );
const matrix = await readMatrix(matrixPath);
await mkdir(outputRoot, { recursive: true });
const results: unknown[] = [];
for (const candidate of matrix.cases) {
  // Provider cases are sequential by authorization and credential-isolation policy.
  // oxlint-disable-next-line no-await-in-loop -- each case owns an isolated provider process.
  const result = await runCase(outputRoot, candidate);
  results.push(result);
  // oxlint-disable-next-line no-await-in-loop -- persist each case before the next provider starts.
  await atomicWrite(join(outputRoot, 'matrix-results.json'), results);
}
console.log(JSON.stringify({ outputRoot, cases: results.length }));
