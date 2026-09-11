import { expect, test, vi } from 'vitest';

import { normalizeAcpConfiguration } from '../../../../src/configuration/catalog.js';
import { validateAgentDefinition } from '../../../../src/definition/index.js';
import { ConfigurationDeadline } from '../../../../src/execution/configuration/deadline.js';
import type { ConfigurationServerSpawner } from '../../../../src/execution/configuration/inspector.js';
import type { ConfigurationInspectionRequest } from '../../../../src/execution/configuration/inspector.js';
import { ConfigurationServerStartError } from '../../../../src/execution/configuration/server-process.js';
import type { ProcessExit } from '../../../../src/process/index.js';
import { createOpenCodeCatalogEnricher } from '../../../../src/providers/opencode/catalog.js';
import { fakeAcpAgentDefinition } from '../../../support/fake-acp/definition.js';

test('enriches the full catalog without changing the selectable revision and reaps the server', async () => {
  const exit: ProcessExit = { exitCode: null, signal: 'SIGTERM' };
  const reap = vi.fn(async () => ({ exit, status: 'confirmed' as const }));
  const process = {
    completion: new Promise<ProcessExit>(() => undefined),
    terminateAndReap: reap,
  };
  let launchArgs: readonly string[] | undefined;
  const spawner: ConfigurationServerSpawner = {
    start: async (request) => {
      launchArgs = request.args;
      request.onStdout(new TextEncoder().encode('server listening on http://127.0.0.1:45123\n'));
      return process;
    },
  };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        all: [{ id: 'openrouter', models: { 'xai/grok': { name: 'Grok' } }, name: 'OpenRouter' }],
        connected: ['openrouter'],
        default: { openrouter: 'xai/grok' },
      }),
      { status: 200 },
    ),
  );
  const definition = validateAgentDefinition(
    fakeAcpAgentDefinition({ id: 'opencode-acp' }),
  ).definition;
  const request: ConfigurationInspectionRequest = {
    definition,
    environment: {},
    idleTimeoutMs: 5_000,
    launch: { executable: 'opencode', reportedVersion: '1.18.23' },
    maxOutputBytes: 1_000,
    redactionSecrets: [],
    signal: AbortSignal.timeout(5_000),
    wallClockTimeoutMs: 5_000,
    workspace: '/workspace',
  };
  const catalog = normalizeAcpConfiguration([
    {
      category: 'model',
      currentValue: 'opencode/big-pickle',
      id: 'model',
      name: 'Model',
      options: [{ name: 'OpenCode/Big Pickle', value: 'opencode/big-pickle' }],
      type: 'select',
    },
  ]);
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);

  try {
    const result = await createOpenCodeCatalogEnricher(spawner).enrich(catalog, request, deadline);
    expect(launchArgs).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '0']);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45123/provider',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.catalogRevision).toBe(catalog.catalogRevision);
    expect(result.model?.providers).toEqual([
      {
        connected: true,
        id: 'openrouter',
        models: [{ connected: true, value: 'openrouter/xai/grok', name: 'Grok' }],
        name: 'OpenRouter',
      },
    ]);
  } finally {
    deadline.finish(request.signal);
    fetchMock.mockRestore();
  }
  expect(reap).toHaveBeenCalledOnce();
});

test.each([
  ['non-success response', new Response('failure', { status: 503 })],
  ['invalid JSON', new Response('{', { status: 200 })],
  ['invalid catalog', new Response(JSON.stringify({ all: [], connected: [] }), { status: 200 })],
])('rejects %s and reaps the server', async (_name, response) => {
  const reap = vi.fn(async () => ({ status: 'confirmed' as const }));
  const process = { completion: new Promise<void>(() => undefined), terminateAndReap: reap };
  const spawner: ConfigurationServerSpawner = {
    start: async (request) => {
      request.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
      return process;
    },
  };
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  const definition = validateAgentDefinition(
    fakeAcpAgentDefinition({ id: 'opencode-acp' }),
  ).definition;
  const request: ConfigurationInspectionRequest = {
    definition,
    environment: {},
    idleTimeoutMs: 5_000,
    launch: { executable: 'opencode', reportedVersion: '1.18.23' },
    maxOutputBytes: 1_000,
    redactionSecrets: [],
    signal: AbortSignal.timeout(5_000),
    wallClockTimeoutMs: 5_000,
    workspace: '/workspace',
  };
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  try {
    await expect(
      createOpenCodeCatalogEnricher(spawner).enrich(
        normalizeAcpConfiguration([
          {
            currentValue: 'model',
            id: 'model',
            name: 'Model',
            options: [{ name: 'Model', value: 'model' }],
            type: 'select',
          },
        ]),
        request,
        deadline,
      ),
    ).rejects.toThrow();
  } finally {
    deadline.finish(request.signal);
    fetchMock.mockRestore();
  }
  expect(reap).toHaveBeenCalledOnce();
});

const enrichmentRequest = (): ConfigurationInspectionRequest => {
  const definition = validateAgentDefinition(
    fakeAcpAgentDefinition({ id: 'opencode-acp' }),
  ).definition;
  return {
    definition,
    environment: {},
    idleTimeoutMs: 5_000,
    launch: { executable: 'opencode', reportedVersion: '1.18.23' },
    maxOutputBytes: 1_000,
    redactionSecrets: [],
    signal: AbortSignal.timeout(5_000),
    wallClockTimeoutMs: 5_000,
    workspace: '/workspace',
  };
};

const enrichmentCatalog = () =>
  normalizeAcpConfiguration([
    {
      currentValue: 'model',
      id: 'model',
      name: 'Model',
      options: [{ name: 'Model', value: 'model' }],
      type: 'select' as const,
    },
  ]);

test('rejects startup that exits before advertising an address', async () => {
  const request = enrichmentRequest();
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  const reap = vi.fn(async () => ({ status: 'confirmed' as const }));
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async (launch) => {
          launch.onStdout(new TextEncoder().encode('unrelated startup output'));
          return { completion: Promise.resolve(), terminateAndReap: reap };
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('exited before readiness');
  } finally {
    deadline.finish(request.signal);
  }
  expect(reap).toHaveBeenCalledOnce();
});

test('passes through ordinary startup errors', async () => {
  const request = enrichmentRequest();
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async () => {
          throw new Error('start failed');
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('start failed');
  } finally {
    deadline.finish(request.signal);
  }
});

test('maps uncertain startup cleanup to a bounded failure', async () => {
  const request = enrichmentRequest();
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async () => {
          throw new ConfigurationServerStartError(true);
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('cleanup was not confirmed');
  } finally {
    deadline.finish(request.signal);
  }
});

test('fails readiness when the shared deadline expires', async () => {
  const request = enrichmentRequest();
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 1);
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async () => ({
          completion: new Promise<void>(() => undefined),
          terminateAndReap: async () => ({ status: 'confirmed' as const }),
        }),
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('server timed_out');
  } finally {
    deadline.finish(request.signal);
  }
});

test('rejects oversized and empty HTTP responses', async () => {
  const request = enrichmentRequest();
  const assertRejected = async (response: Response): Promise<void> => {
    const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const reap = vi.fn(async () => ({ status: 'confirmed' as const }));
    try {
      await expect(
        createOpenCodeCatalogEnricher({
          start: async (launch) => {
            launch.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
            return { completion: new Promise<void>(() => undefined), terminateAndReap: reap };
          },
        }).enrich(enrichmentCatalog(), request, deadline),
      ).rejects.toThrow();
    } finally {
      deadline.finish(request.signal);
      fetchMock.mockRestore();
    }
  };
  await assertRejected(
    new Response('x', { headers: { 'content-length': String(33 * 1024 * 1024) } }),
  );
  await assertRejected({ headers: new Headers(), body: null, ok: true, status: 200 } as Response);
});

test('reports uncertain cleanup when readiness exits before HTTP starts', async () => {
  const request = enrichmentRequest();
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async () => ({
          completion: Promise.resolve(),
          terminateAndReap: async () => ({ status: 'uncertain' as const }),
        }),
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('cleanup was not confirmed');
  } finally {
    deadline.finish(request.signal);
  }
});

test('rejects malformed and oversized response streams', async () => {
  const request = enrichmentRequest();
  const assertRejected = async (body: ReadableStream<Uint8Array>): Promise<void> => {
    const response = new Response(body);
    const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    try {
      await expect(
        createOpenCodeCatalogEnricher({
          start: async (launch) => {
            launch.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
            return {
              completion: new Promise<void>(() => undefined),
              terminateAndReap: async () => ({ status: 'confirmed' as const }),
            };
          },
        }).enrich(enrichmentCatalog(), request, deadline),
      ).rejects.toThrow();
    } finally {
      deadline.finish(request.signal);
      fetchMock.mockRestore();
    }
  };
  await assertRejected(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(33 * 1024 * 1024));
        controller.close();
      },
    }),
  );
  await assertRejected(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        controller.close();
      },
    }),
  );
  const malformedResponse = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: 'not bytes' }),
        cancel: async () => {
          throw new Error('cancel failed');
        },
      }),
    },
    ok: true,
    status: 200,
  } as unknown as Response;
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(malformedResponse);
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async (launch) => {
          launch.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
          return {
            completion: new Promise<void>(() => undefined),
            terminateAndReap: async () => ({ status: 'confirmed' as const }),
          };
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('stream is invalid');
  } finally {
    deadline.finish(request.signal);
    fetchMock.mockRestore();
  }
});

test('stops reading when the shared signal is already aborted', async () => {
  const request = { ...enrichmentRequest(), signal: AbortSignal.abort() };
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ all: [{ id: 'p', models: { m: {} } }], connected: [] })),
    );
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async (launch) => {
          launch.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
          return {
            completion: new Promise<void>(() => undefined),
            terminateAndReap: async () => ({ status: 'confirmed' as const }),
          };
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('aborted');
  } finally {
    deadline.finish(request.signal);
    fetchMock.mockRestore();
  }
});

test('reports uncertain cleanup while stopping a ready server', async () => {
  const request = enrichmentRequest();
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ all: [{ id: 'p', models: { m: {} } }], connected: [] })),
    );
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async (launch) => {
          launch.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
          return {
            completion: new Promise<void>(() => undefined),
            terminateAndReap: async () => ({ status: 'uncertain' as const }),
          };
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).rejects.toThrow('cleanup was not confirmed');
  } finally {
    deadline.finish(request.signal);
    fetchMock.mockRestore();
  }
});

test('passes credentials to a protected owned server on a successful response', async () => {
  const request = { ...enrichmentRequest(), environment: { OPENCODE_SERVER_PASSWORD: 'secret' } };
  const deadline = new ConfigurationDeadline(request.signal, 5_000, 5_000);
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ all: [{ id: 'p', models: { m: {} } }], connected: [] })),
    );
  try {
    await expect(
      createOpenCodeCatalogEnricher({
        start: async (launch) => {
          launch.onStdout(new TextEncoder().encode('http://127.0.0.1:45123'));
          return {
            completion: new Promise<void>(() => undefined),
            terminateAndReap: async () => ({ status: 'confirmed' as const }),
          };
        },
      }).enrich(enrichmentCatalog(), request, deadline),
    ).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45123/provider',
      expect.objectContaining({ headers: { authorization: 'Basic b3BlbmNvZGU6c2VjcmV0' } }),
    );
  } finally {
    deadline.finish(request.signal);
    fetchMock.mockRestore();
  }
});
