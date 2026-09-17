import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { prepareInstructionsDelivery } from '../../../src/execution/instructions/prepare.js';
import {
  createAgentManager,
  type AgentSessionEvent,
  type AgentSessionLaunchContext,
  type AgentSessionResumeToken,
} from '../../../src/index.js';
import { nodeOutputArtifactPlatform } from '../../../src/platform/node/output/artifact.js';
import { withTemporaryDirectory } from '../../support/assertions/temporary-directory.js';
import { invocationOutputDirectory } from '../../support/builders/public-agent-manager.js';
import { inboundParams, promptTexts, readFakeAcpTrace } from '../../support/fake-acp/trace.js';
import { fakeAcpDefinition } from '../../support/fakes/fake-acp.js';
import { noOpActiveStateSink } from '../../support/stories/active-state.js';

const instructions = 'Prefer terse answers. nonce-51d0';
const fileName = 'revo-opencode-instructions.md';
const fileDelivery = {
  channel: 'opencode:config.instructions-file',
  mode: 'native_append',
} as const;
const prefixDelivery = { channel: 'acp:session/prompt.prefix', mode: 'prompt_prefix' } as const;
const configuration = (outputDirectory: string) =>
  JSON.stringify({ instructions: [join(outputDirectory, fileName)] });
const callerConfiguration: AgentSessionLaunchContext = {
  environment: {
    inherit: [],
    secrets: {},
    variables: { OPENCODE_CONFIG_CONTENT: '{"custom":true}' },
  },
};

const openCodeLike = (
  traceFile: string,
  options: {
    readonly environment?: Record<string, string>;
    readonly reportedVersion?: string;
    readonly resume?: 'native';
  } = {},
) =>
  fakeAcpDefinition({
    id: 'opencode-acp',
    mode: 'instructions-file',
    reportedVersion: options.reportedVersion ?? '1.18.23',
    traceFile,
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.resume === undefined ? {} : { resume: options.resume }),
  });

const request = (directory: string, invocationId: string, outputDirectory?: string) => ({
  agent: { id: 'opencode-acp', version: '1.0.0' },
  instructions,
  invocationId,
  output: { directory: outputDirectory ?? invocationOutputDirectory(directory, invocationId) },
  parameters: {},
  permissions: {},
  prompt: 'Return the fake result.',
  result: { schema: { type: 'object' } },
  workspace: { directory },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fake echoes the files it read as JSON; the first entry is the runtime-owned file. */
const echoedFile = (content: unknown): unknown => {
  const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content;
  const files = isRecord(parsed) ? parsed.files : undefined;
  return Array.isArray(files) ? (files as readonly unknown[])[0] : files;
};

const missing = async (path: string) =>
  stat(path).then(
    () => false,
    () => true,
  );

const sessionManager = (
  definitions: ReturnType<typeof fakeAcpDefinition>[],
  events: AgentSessionEvent[],
) =>
  createAgentManager({
    activeStateSink: noOpActiveStateSink,
    definitions,
    sessions: {
      activeStateSink: {
        remove: async () => ({ state: 'applied' }),
        save: async () => ({ state: 'applied' }),
      },
      eventSink: {
        append: async (event) => {
          events.push(event);
          return { state: 'appended' };
        },
      },
    },
  });

const launch = (directory: string, outputDirectory: string, sessionId: string) => ({
  agent: { id: 'opencode-acp', version: '1.0.0' },
  instructions,
  output: { directory: outputDirectory },
  parameters: {},
  permissions: {},
  sessionId,
  workspace: { directory },
});

const decodedPayload = (token: AgentSessionResumeToken): string =>
  Buffer.from(token.payload.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');

const runtimeOwnedEvents = (events: readonly AgentSessionEvent[]) =>
  events.filter((event) => !event.type.startsWith('assistant.'));

test('an eligible invocation binds a private instructions file only for the process lifetime', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'opencode.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [openCodeLike(traceFile)],
    });
    await manager.initialize([]);
    const start = request(directory, 'file');
    const result = await (await manager.start(start)).result();
    const trace = await readFakeAcpTrace(traceFile);
    await manager.shutdown();

    expect(trace.environment.OPENCODE_CONFIG_CONTENT).toBe(configuration(start.output.directory));
    expect(inboundParams(trace, 'session/new')).toEqual({ cwd: directory, mcpServers: [] });
    expect(promptTexts(trace)[0]).toMatch(/^Return the fake result\.\n\nRevo invocation contract/);
    expect(result).toMatchObject({ instructionsDelivery: fileDelivery, status: 'succeeded' });
    if (result.status !== 'succeeded') throw new Error('Expected success.');
    expect(echoedFile(result.value)).toEqual({
      content: instructions,
      mode: '600',
      path: join(start.output.directory, fileName),
    });
    expect((await readdir(start.output.directory)).sort()).toEqual([
      'events.ndjson',
      'result.json',
      'stderr.log',
      'stdout.log',
    ]);
    expect(JSON.stringify({ ...result, value: undefined })).not.toContain(fileName);
  });
});

test.each([
  ['an unverified reported version', { reportedVersion: '1.18.22' }, undefined],
  [
    'a definition binding of the config variable',
    { environment: { OPENCODE_CONFIG_CONTENT: '{"definition":true}' } },
    undefined,
  ],
  ['a caller binding of the config variable', {}, callerConfiguration],
] as const)(
  '%s keeps the prefix, writes no file, and preserves the existing binding',
  async (_label, options, context) => {
    await withTemporaryDirectory(async (directory) => {
      const traceFile = join(directory, 'ineligible.trace.json');
      const manager = createAgentManager({
        activeStateSink: noOpActiveStateSink,
        definitions: [openCodeLike(traceFile, options)],
      });
      await manager.initialize([]);
      const start = request(directory, 'ineligible');
      const result = await (await manager.start(start, context)).result();
      const trace = await readFakeAcpTrace(traceFile);
      await manager.shutdown();

      expect(trace.environment.OPENCODE_CONFIG_CONTENT).toBe(
        'environment' in options
          ? options.environment.OPENCODE_CONFIG_CONTENT
          : context?.environment?.variables.OPENCODE_CONFIG_CONTENT,
      );
      expect(promptTexts(trace)[0]).toMatch(/^<<<REVO_INSTRUCTIONS>>>\n/);
      expect(result).toMatchObject({ instructionsDelivery: prefixDelivery });
      expect(await missing(join(start.output.directory, fileName))).toBe(true);
    });
  },
);

test('a brace in the output directory keeps the prefix and writes no file', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [openCodeLike(join(directory, 'brace.trace.json'))],
    });
    await manager.initialize([]);
    const start = request(directory, 'brace', join(directory, 'out-{env:HOME}'));
    const result = await (await manager.start(start)).result();
    await manager.shutdown();

    expect(result).toMatchObject({ instructionsDelivery: prefixDelivery });
    expect(await missing(join(start.output.directory, fileName))).toBe(true);
  });
});

test.each(['close', 'cancel', 'idle_timeout'] as const)(
  'a session removes its file only after the %s terminal path and never records it',
  async (terminal) => {
    await withTemporaryDirectory(async (directory) => {
      const traceFile = join(directory, `${terminal}.trace.json`);
      const events: AgentSessionEvent[] = [];
      const manager = sessionManager([openCodeLike(traceFile)], events);
      await manager.initialize([]);
      const outputDirectory = join(directory, `${terminal}-output`);
      const session = await manager.sessions.open({
        ...launch(directory, outputDirectory, terminal),
        ...(terminal === 'idle_timeout' ? { limits: { idleTimeoutMs: 1_000 } } : {}),
      });
      const filePath = join(outputDirectory, fileName);
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
      const first = await (await session.send({ prompt: 'first', turnId: 'first' })).result();
      expect(first).toMatchObject({ status: 'completed' });
      if (first.status !== 'completed') throw new Error('Expected completion.');
      expect(echoedFile(first.message.content)).toMatchObject({
        content: instructions,
        mode: '600',
      });
      expect(manager.sessions.inspect(terminal)).toMatchObject({
        instructionsDelivery: fileDelivery,
      });
      expect(await missing(filePath)).toBe(false);

      if (terminal === 'close') await session.close();
      else if (terminal === 'cancel') await session.cancel();
      else
        await expect
          .poll(() => manager.sessions.getTerminal(terminal)?.status, { timeout: 4_000 })
          .toBe('timed_out');
      await manager.shutdown();
      const trace = await readFakeAcpTrace(traceFile);

      expect(trace.environment.OPENCODE_CONFIG_CONTENT).toBe(configuration(outputDirectory));
      expect(promptTexts(trace)).toEqual(['first']);
      await expect.poll(() => missing(filePath)).toBe(true);
      expect((await readdir(outputDirectory)).sort()).toEqual([
        'session.json',
        'stderr.log',
        'stdout.log',
      ]);
      const published = JSON.stringify({
        events: runtimeOwnedEvents(events),
        terminal: manager.sessions.getTerminal(terminal),
      });
      expect(published).not.toContain(fileName);
      expect(published).not.toContain('nonce-51d0');
    });
  },
);

test('a rejected native session removes the file it created', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'reject.trace.json');
    const manager = sessionManager(
      [
        fakeAcpDefinition({
          id: 'opencode-acp',
          mode: 'session-new-reject',
          reportedVersion: '1.18.23',
          session: true,
          traceFile,
        }),
      ],
      [],
    );
    await manager.initialize([]);
    const outputDirectory = join(directory, 'reject-output');
    await expect(
      manager.sessions.open(launch(directory, outputDirectory, 'reject')),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.protocol_failed' },
    });
    await manager.shutdown();
    const trace = await readFakeAcpTrace(traceFile);

    expect(trace.environment.OPENCODE_CONFIG_CONTENT).toBe(configuration(outputDirectory));
    expect(await missing(join(outputDirectory, fileName))).toBe(true);
  });
});

test('a missing output parent fails opening before any process starts', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'conflict.trace.json');
    const manager = createAgentManager({
      activeStateSink: noOpActiveStateSink,
      definitions: [openCodeLike(traceFile)],
      sessions: {
        activeStateSink: {
          remove: async () => ({ state: 'applied' }),
          save: async () => ({ state: 'applied' }),
        },
        eventSink: { append: async () => ({ state: 'appended' }) },
      },
    });
    await manager.initialize([]);
    const failing = manager.sessions.open(
      launch(directory, join(directory, 'conflict-output', 'nested'), 'conflict'),
    );
    await expect(failing).rejects.toMatchObject({
      fault: { code: 'revo.agent.output_path_invalid' },
    });
    await manager.shutdown();
    expect(await missing(traceFile)).toBe(true);
  });
});

test('a reserved instruction file already in the claimed directory fails closed without prefixing', async () => {
  await withTemporaryDirectory(async (directory) => {
    const claimed = join(directory, 'claimed');
    await mkdir(claimed, { mode: 0o700 });
    const reserved = join(claimed, fileName);
    await writeFile(reserved, 'pre-existing');
    await expect(
      nodeOutputArtifactPlatform.createPrivateFile(
        reserved,
        new TextEncoder().encode(instructions),
      ),
    ).resolves.toBe('conflict');
    await expect(
      prepareInstructionsDelivery({
        artifacts: nodeOutputArtifactPlatform,
        request: {
          definitionId: 'opencode-acp',
          definitionVersion: '1.0.0',
          environmentNames: [],
          instructions,
          outputDirectory: claimed,
          reportedVersion: '1.18.23',
        },
        resolve: () => ({
          artifact: { bytes: new TextEncoder().encode(instructions), path: reserved },
          channel: 'opencode:config.instructions-file',
          environment: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [reserved] }) },
          mode: 'native_append',
        }),
      }),
    ).resolves.toEqual({ status: 'write_failed' });
  });
});

test('fake-native resume recreates the file, honors the stored mode rule, and rejects changed instructions', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'resume.trace.json');
    const events: AgentSessionEvent[] = [];
    const manager = sessionManager([openCodeLike(traceFile, { resume: 'native' })], events);
    await manager.initialize([]);
    const firstOutput = join(directory, 'resume-1');
    const session = await manager.sessions.open(launch(directory, firstOutput, 'resume'));
    await (await session.send({ prompt: 'first', turnId: 'first' })).result();
    const hibernation = await session.hibernate();
    if (hibernation.state !== 'hibernated') throw new Error('Expected hibernation.');
    await expect.poll(() => missing(join(firstOutput, fileName))).toBe(true);
    const payload = decodedPayload(hibernation.resumeToken);
    expect(payload).toContain('"instructionsDelivery":{"mode":"native_append"}');
    expect(payload).toContain('"instructionsDispatched":false');
    expect(payload).toMatch(/"instructionsDigest":"[a-f0-9]{64}"/);
    expect(payload).not.toContain('nonce-51d0');
    expect(payload).not.toContain(fileName);

    const resumeInput = (outputDirectory: string, text: string | undefined) => ({
      ...(text === undefined ? {} : { instructions: text }),
      output: { directory: outputDirectory },
      parameters: {},
      permissions: {},
      token: hibernation.resumeToken,
      workspace: { directory },
    });
    await expect(
      manager.sessions.resume(resumeInput(join(directory, 'changed'), 'Changed. nonce-51d0')),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.checkpoint_invalid' },
    });
    await expect(
      manager.sessions.resume(resumeInput(join(directory, 'omitted'), undefined)),
    ).rejects.toMatchObject({
      fault: { code: 'revo.agent.checkpoint_invalid' },
    });

    const secondOutput = join(directory, 'resume-2');
    const resumed = await manager.sessions.resume(resumeInput(secondOutput, instructions));
    const resumedTurn = await (await resumed.send({ prompt: 'again', turnId: 'again' })).result();
    if (resumedTurn.status !== 'completed') throw new Error('Expected completion.');
    expect(echoedFile(resumedTurn.message.content)).toEqual({
      content: instructions,
      mode: '600',
      path: join(secondOutput, fileName),
    });
    expect(manager.sessions.inspect('resume')).toMatchObject({
      instructionsDelivery: fileDelivery,
    });
    const secondHibernation = await resumed.hibernate();
    if (secondHibernation.state !== 'hibernated') throw new Error('Expected hibernation.');
    await expect.poll(() => missing(join(secondOutput, fileName))).toBe(true);

    const thirdOutput = join(directory, 'resume-3');
    const ineligible = await manager.sessions.resume(
      { ...resumeInput(thirdOutput, instructions), token: secondHibernation.resumeToken },
      callerConfiguration,
    );
    await (await ineligible.send({ prompt: 'third', turnId: 'third' })).result();
    await (await ineligible.send({ prompt: 'fourth', turnId: 'fourth' })).result();
    expect(manager.sessions.inspect('resume')).toMatchObject({
      instructionsDelivery: prefixDelivery,
    });
    expect(await missing(join(thirdOutput, fileName))).toBe(true);
    await ineligible.close();
    await manager.shutdown();
    const trace = await readFakeAcpTrace(traceFile);

    expect(promptTexts(trace)).toEqual([
      `<<<REVO_INSTRUCTIONS>>>\n${instructions}\n<<<END_REVO_INSTRUCTIONS>>>\n\nthird`,
      'fourth',
    ]);
    expect(trace.environment.OPENCODE_CONFIG_CONTENT).toBe('{"custom":true}');
  });
});

test('a stored prefix stays a prefix on resume even when native becomes eligible, and is never sent twice', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'prefix-resume.trace.json');
    const manager = sessionManager([openCodeLike(traceFile, { resume: 'native' })], []);
    await manager.initialize([]);
    const session = await manager.sessions.open(
      launch(directory, join(directory, 'prefix-1'), 'prefix'),
      callerConfiguration,
    );
    await (await session.send({ prompt: 'first', turnId: 'first' })).result();
    const hibernation = await session.hibernate();
    if (hibernation.state !== 'hibernated') throw new Error('Expected hibernation.');
    expect(decodedPayload(hibernation.resumeToken)).toContain('"instructionsDispatched":true');

    const secondOutput = join(directory, 'prefix-2');
    const resumed = await manager.sessions.resume({
      instructions,
      output: { directory: secondOutput },
      parameters: {},
      permissions: {},
      token: hibernation.resumeToken,
      workspace: { directory },
    });
    await (await resumed.send({ prompt: 'second', turnId: 'second' })).result();
    expect(manager.sessions.inspect('prefix')).toMatchObject({
      instructionsDelivery: prefixDelivery,
    });
    await expect.poll(() => missing(join(secondOutput, fileName))).toBe(true);
    await resumed.close();
    await manager.shutdown();
    const trace = await readFakeAcpTrace(traceFile);

    expect(promptTexts(trace)).toEqual(['second']);
    expect(trace.environment.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });
});

test('a checkpoint before the first turn keeps the prefix pending for the resumed session', async () => {
  await withTemporaryDirectory(async (directory) => {
    const traceFile = join(directory, 'pending-prefix.trace.json');
    const manager = sessionManager(
      [fakeAcpDefinition({ mode: 'session', resume: 'native', traceFile })],
      [],
    );
    await manager.initialize([]);
    const session = await manager.sessions.open({
      agent: { id: 'codex', version: '1.0.0' },
      instructions,
      output: { directory: join(directory, 'pending-1') },
      parameters: {},
      permissions: {},
      sessionId: 'pending',
      workspace: { directory },
    });
    const hibernation = await session.hibernate();
    if (hibernation.state !== 'hibernated') throw new Error('Expected hibernation.');
    const resumed = await manager.sessions.resume({
      instructions,
      output: { directory: join(directory, 'pending-2') },
      parameters: {},
      permissions: {},
      token: hibernation.resumeToken,
      workspace: { directory },
    });
    await (await resumed.send({ prompt: 'first', turnId: 'first' })).result();
    await resumed.close();
    await manager.shutdown();

    expect(promptTexts(await readFakeAcpTrace(traceFile))).toEqual([
      `<<<REVO_INSTRUCTIONS>>>\n${instructions}\n<<<END_REVO_INSTRUCTIONS>>>\n\nfirst`,
    ]);
  });
});

test('a legacy checkpoint without instructions cannot acquire them on resume', async () => {
  await withTemporaryDirectory(async (directory) => {
    const manager = sessionManager([fakeAcpDefinition({ mode: 'session', resume: 'native' })], []);
    await manager.initialize([]);
    const session = await manager.sessions.open({
      agent: { id: 'codex', version: '1.0.0' },
      output: { directory: join(directory, 'legacy-1') },
      parameters: {},
      permissions: {},
      sessionId: 'legacy',
      workspace: { directory },
    });
    const hibernation = await session.hibernate();
    if (hibernation.state !== 'hibernated') throw new Error('Expected hibernation.');
    expect(decodedPayload(hibernation.resumeToken)).not.toContain('instructionsDigest');

    await expect(
      manager.sessions.resume({
        instructions,
        output: { directory: join(directory, 'legacy-2') },
        parameters: {},
        permissions: {},
        token: hibernation.resumeToken,
        workspace: { directory },
      }),
    ).rejects.toMatchObject({ fault: { code: 'revo.agent.checkpoint_invalid' } });
    const resumed = await manager.sessions.resume({
      output: { directory: join(directory, 'legacy-3') },
      parameters: {},
      permissions: {},
      token: hibernation.resumeToken,
      workspace: { directory },
    });
    await resumed.close();
    await manager.shutdown();
  });
});
