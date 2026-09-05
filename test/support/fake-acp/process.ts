import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PassThrough, Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

import { fakeAcpOptions } from './cli.js';
import { resultTextForMode } from './result.js';

const { configurationStateFile, descendantPidFile, mode, readyFile, traceFile } = fakeAcpOptions();
const inboundChunks: string[] = [];
const outboundChunks: string[] = [];
const protocolOutput = new PassThrough();
let closeReceived = false;
let cancelReceived = false;
let closeCalls = 0;
let cancelCalls = 0;
let configurationOptions: acp.SessionConfigOption[] = [];
let remembered = '';
let pendingSessionPrompt: ReturnType<typeof Promise.withResolvers<acp.PromptResponse>> | undefined;

const configurationState = async (): Promise<string | undefined> => {
  if (configurationStateFile === undefined) return undefined;
  const value: unknown = JSON.parse(await readFile(configurationStateFile, 'utf8'));
  if (typeof value !== 'object' || value === null || !('model' in value)) return undefined;
  return typeof value.model === 'string' ? value.model : undefined;
};

const fakeConfigurationOptions = async (): Promise<acp.SessionConfigOption[]> => {
  const selectedState = await configurationState();
  const currentModel =
    mode === 'configuration-current-outside-picker'
      ? 'bridge-current'
      : (selectedState ?? 'provider-a/alpha');
  const models =
    selectedState === 'legacy'
      ? [{ name: 'Legacy', value: 'legacy' }]
      : selectedState === 'current'
        ? [{ name: 'Current', value: 'current' }]
        : undefined;
  const options: acp.SessionConfigOption[] = [
    {
      category: 'model',
      currentValue: currentModel,
      id: 'model',
      name: 'Model',
      options: models ?? [
        {
          group: 'provider-a',
          name: 'Provider A',
          options: [{ name: 'Alpha', value: 'provider-a/alpha' }],
        },
        {
          group: 'provider-b',
          name: 'Provider B',
          options: [{ name: 'Beta', value: 'provider-b/beta' }],
        },
      ],
      type: 'select',
    },
    {
      category: 'thought_level',
      currentValue: 'medium',
      id: 'reasoning_effort',
      name: 'Reasoning effort',
      options: [
        { name: 'Low', value: 'low' },
        { name: 'Medium', value: 'medium' },
        { name: 'High', value: 'high' },
      ],
      type: 'select',
    },
    { currentValue: true, id: 'fast', name: 'Fast', type: 'boolean' },
  ];
  if (mode === 'configuration-empty-default')
    options.push({
      category: '_agent',
      currentValue: '',
      id: 'agent',
      name: 'Agent',
      options: [
        { description: 'Default Copilot agent', name: 'Copilot', value: '' },
        { name: 'Code reviewer', value: 'code-reviewer' },
      ],
      type: 'select',
    });
  return options;
};

process.stdin.on('data', (chunk: Buffer) => inboundChunks.push(chunk.toString('utf8')));
protocolOutput.on('data', (chunk: Buffer) => outboundChunks.push(chunk.toString('utf8')));
protocolOutput.pipe(process.stdout);

const stream = acp.ndJsonStream(Writable.toWeb(protocolOutput), Readable.toWeb(process.stdin));

const frames = (chunks: readonly string[]): readonly unknown[] =>
  chunks
    .join('')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);

const trace = (exited: boolean): string =>
  `${JSON.stringify({ cancelCalls, cancelReceived, closeCalls, closeReceived, exited, inbound: frames(inboundChunks), outbound: frames(outboundChunks) })}\n`;

const writeTrace = async (): Promise<void> => {
  if (traceFile === undefined) return;
  await writeFile(traceFile, trace(false), 'utf8');
};

process.on('exit', () => {
  if (traceFile === undefined) return;
  writeFileSync(traceFile, trace(true), 'utf8');
});

process.on('SIGTERM', () => {
  if (mode === 'stubborn-descendant') return;
  if (traceFile !== undefined) writeFileSync(traceFile, trace(true), 'utf8');
  process.exit(0);
});

acp
  .agent({ name: 'revo-fake-acp-agent' })
  .onRequest(acp.methods.agent.initialize, () => {
    if (mode === 'oversized-frame') {
      protocolOutput.write('x'.repeat(1_048_577));
      return new Promise<never>(() => undefined);
    }
    return {
      agentCapabilities: { sessionCapabilities: { close: {} } },
      protocolVersion: acp.PROTOCOL_VERSION,
    };
  })
  .onRequest(acp.methods.agent.session.new, async () => {
    if (mode === 'configuration-hang') {
      if (readyFile !== undefined) writeFileSync(readyFile, 'ready\n', 'utf8');
      return new Promise<never>(() => undefined);
    }
    configurationOptions = mode.startsWith('configuration') ? await fakeConfigurationOptions() : [];
    return {
      ...(mode.startsWith('configuration') ? { configOptions: configurationOptions } : {}),
      sessionId: 'fake-acp-session',
    };
  })
  .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
    configurationOptions = configurationOptions.map((option) => {
      if (option.id === params.configId) {
        if (option.type === 'boolean' && typeof params.value === 'boolean')
          return { ...option, currentValue: params.value };
        if (option.type === 'select' && typeof params.value === 'string')
          return { ...option, currentValue: params.value };
      }
      if (
        params.configId === 'model' &&
        params.value === 'provider-b/beta' &&
        option.id === 'reasoning_effort' &&
        option.type === 'select'
      )
        return {
          ...option,
          currentValue: 'high',
          options: [
            { name: 'High', value: 'high' },
            { name: 'Extra high', value: 'xhigh' },
          ],
        };
      return option;
    });
    return {
      configOptions:
        mode === 'configuration-invalid-after-set'
          ? [...configurationOptions, configurationOptions[0]!]
          : configurationOptions,
    };
  })
  .onNotification(acp.methods.agent.session.cancel, async () => {
    cancelReceived = true;
    cancelCalls += 1;
    pendingSessionPrompt?.resolve({ stopReason: 'cancelled' });
    pendingSessionPrompt = undefined;
    await writeTrace();
  })
  .onRequest(acp.methods.agent.session.prompt, async (context) => {
    if (readyFile !== undefined) writeFileSync(readyFile, 'ready\n', 'utf8');
    if (mode === 'malformed') {
      protocolOutput.write('{not-json}\n', () => process.exit(0));
      return new Promise<never>(() => undefined);
    }
    if (mode === 'eof') {
      protocolOutput.end(() => process.exit(0));
      return new Promise<never>(() => undefined);
    }
    if (mode === 'exit-without-terminal') process.exit(0);
    if (mode === 'unknown') await context.client.notify('revo/unknown', {});
    if (mode === 'unknown-activity') {
      const timer = setInterval(() => void context.client.notify('revo/unknown', {}), 20);
      timer.unref();
      return new Promise<never>(() => undefined);
    }
    if (mode === 'raw-activity') {
      const timer = setInterval(() => protocolOutput.write('\n'), 20);
      timer.unref();
      return new Promise<never>(() => undefined);
    }
    if (mode === 'valid-activity') {
      const sendUpdates = async (remaining: number): Promise<void> => {
        if (remaining === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: {
            content: { text: '', type: 'text' },
            sessionUpdate: 'agent_message_chunk',
          },
        });
        await sendUpdates(remaining - 1);
      };
      await sendUpdates(3);
    }
    if (mode === 'hang') return new Promise<never>(() => undefined);
    if (mode === 'session-cancellation') {
      if (
        context.params.prompt.some(
          (block) => block.type === 'text' && block.text.startsWith('Do not use tools.'),
        )
      ) {
        await context.client.notify(acp.methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: {
            content: { type: 'text', text: 'Acknowledged.' },
            sessionUpdate: 'agent_message_chunk',
          },
        });
        return { stopReason: 'end_turn' };
      }
      pendingSessionPrompt = Promise.withResolvers<acp.PromptResponse>();
      return pendingSessionPrompt.promise;
    }
    if (mode === 'session') {
      const prompt = context.params.prompt.find((block) => block.type === 'text');
      if (remembered.length === 0 && prompt?.type === 'text') remembered = prompt.text;
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          content: { text: remembered, type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        },
      });
      return { stopReason: 'end_turn' };
    }
    if (
      mode === 'recovery' &&
      context.params.prompt.some(
        (block) => block.type === 'text' && block.text.includes('remain active'),
      )
    )
      return new Promise<never>(() => undefined);
    if (mode === 'stubborn-descendant') {
      const descendant = spawn(
        process.execPath,
        ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        { stdio: 'ignore' },
      );
      if (descendant.pid === undefined || descendantPidFile === undefined)
        throw new Error('Stubborn descendant fixture is missing its pid file.');
      writeFileSync(descendantPidFile, `${descendant.pid}\n`, 'utf8');
      descendant.unref();
      return new Promise<never>(() => undefined);
    }
    if (mode === 'non-text-updates') {
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          content: { text: 'internal thought', type: 'text' },
          sessionUpdate: 'agent_thought_chunk',
        },
      });
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          content: { data: '', mimeType: 'image/png', type: 'image' },
          sessionUpdate: 'agent_message_chunk',
        },
      });
    }
    if (mode === 'session-interactions') {
      await context.client.request(acp.methods.client.session.requestPermission, {
        options: [
          { kind: 'allow_once', name: 'Allow fixture action', optionId: 'allow-fixture' },
          { kind: 'reject_once', name: 'Reject fixture action', optionId: 'reject-fixture' },
        ],
        sessionId: context.params.sessionId,
        toolCall: {
          kind: 'execute',
          status: 'pending',
          title: 'Run fixture action',
          toolCallId: 'fixture-tool-call',
        },
      });
      await context.client.request(acp.methods.client.elicitation.create, {
        message: 'Choose fixture deliverables.',
        mode: 'form',
        requestedSchema: {
          properties: {
            tasks: {
              items: { enum: ['tests', 'docs'], type: 'string' },
              maxItems: 2,
              type: 'array',
            },
          },
          required: ['tasks'],
          type: 'object',
        },
        sessionId: context.params.sessionId,
      });
    }
    if (mode === 'permission-request' || mode === 'permission-without-rejection') {
      await context.client.request(acp.methods.client.session.requestPermission, {
        options:
          mode === 'permission-request'
            ? [
                { kind: 'allow_once', name: 'Allow fixture action', optionId: 'allow-fixture' },
                { kind: 'reject_once', name: 'Reject fixture action', optionId: 'reject-fixture' },
              ]
            : [{ kind: 'allow_once', name: 'Allow fixture action', optionId: 'allow-fixture' }],
        sessionId: context.params.sessionId,
        toolCall: {
          kind: 'execute',
          status: 'pending',
          title: 'Run fixture action',
          toolCallId: 'fixture-tool-call',
        },
      });
    }
    if (mode === 'literal-secret-result') process.stderr.write('stderr literal-secret\n');
    const resultText = resultTextForMode(mode);
    if (mode !== 'missing-result')
      await context.client.notify(acp.methods.client.session.update, {
        sessionId: context.params.sessionId,
        update: {
          content: { text: resultText, type: 'text' },
          sessionUpdate: 'agent_message_chunk',
        },
      });
    return mode === 'usage-result'
      ? {
          stopReason: 'end_turn',
          usage: { inputTokens: 21, outputTokens: 8, totalTokens: 29 },
        }
      : { stopReason: 'end_turn' };
  })
  .onRequest(acp.methods.agent.session.close, async () => {
    closeReceived = true;
    closeCalls += 1;
    await writeTrace();
    return {};
  })
  .connect(stream);
