import type { NormalizedAcpConfiguration } from '../../configuration/catalog.js';
import type {
  AgentConfigurationKnownModel,
  AgentConfigurationProviderModels,
} from '../../contracts/configuration.js';
import type { ConfigurationDeadline } from '../../execution/configuration/deadline.js';
import {
  type ConfigurationCatalogEnricher,
  type ConfigurationInspectionRequest,
  type ConfigurationServerProcess,
  type ConfigurationServerSpawner,
} from '../../execution/configuration/inspector.js';
import { ConfigurationServerStartError } from '../../execution/configuration/server-process.js';
import { createBoundedOutput } from '../../execution/output/bounded-output.js';
import { launchEnvironment } from '../../execution/process/launch-environment.js';

const maximumServerOutputBytes = 64 * 1024;
const maximumProviderResponseBytes = 32 * 1024 * 1024;
const serverArgs = ['serve', '--hostname', '127.0.0.1', '--port', '0'] as const;

class OpenCodeCatalogError extends Error {
  readonly cleanupUncertain: boolean;

  constructor(message: string, cleanupUncertain = false) {
    super(message);
    this.name = 'OpenCodeCatalogError';
    this.cleanupUncertain = cleanupUncertain;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const modelEntries = (value: Record<string, unknown>): readonly [string, unknown][] => {
  if (!isRecord(value) || !isRecord(value.models))
    throw new OpenCodeCatalogError('OpenCode provider models are invalid.');
  return Object.entries(value.models);
};

const providerEntries = (
  value: readonly unknown[],
): readonly [string, Record<string, unknown>][] => {
  return value.flatMap((provider) => {
    if (!isRecord(provider)) return [];
    const id = stringValue(provider.id);
    return id === undefined ? [] : [[id, provider]];
  });
};

export const parseOpenCodeProviderCatalog = (
  value: unknown,
): readonly AgentConfigurationProviderModels[] => {
  if (!isRecord(value)) throw new OpenCodeCatalogError('OpenCode provider catalog is invalid.');
  if (!Array.isArray(value.all) || !Array.isArray(value.connected))
    throw new OpenCodeCatalogError('OpenCode provider catalog is incomplete.');
  if (!value.connected.every((id): id is string => typeof id === 'string' && id.length > 0))
    throw new OpenCodeCatalogError('OpenCode connected provider ids are invalid.');
  const connected = new Set(value.connected);
  const providers = providerEntries(value.all).map(([id, provider]) => {
    const providerConnected = connected.has(id);
    const models = modelEntries(provider).map(([modelId, model]): AgentConfigurationKnownModel =>
      Object.freeze({
        connected: providerConnected,
        value: `${id}/${modelId}`,
        name: isRecord(model) ? (stringValue(model.name) ?? modelId) : modelId,
      }),
    );
    return {
      connected: providerConnected,
      id,
      models,
      name: stringValue(provider.name) ?? id,
    };
  });
  if (providers.length === 0) throw new OpenCodeCatalogError('OpenCode provider catalog is empty.');
  return Object.freeze(
    providers.map((provider) =>
      Object.freeze({ ...provider, models: Object.freeze(provider.models) }),
    ),
  );
};

const isReadResult = (
  value: unknown,
): value is { readonly done: true } | { readonly done: false; readonly value: Uint8Array } =>
  isRecord(value) &&
  typeof value.done === 'boolean' &&
  (value.done || value.value instanceof Uint8Array);

const readResponse = async (response: Response, signal: AbortSignal): Promise<unknown> => {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > maximumProviderResponseBytes)
    throw new OpenCodeCatalogError('OpenCode provider response exceeds the size limit.');
  if (response.body === null)
    throw new OpenCodeCatalogError('OpenCode provider response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const readChunks = async (size: number): Promise<number> => {
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const next: unknown = await reader.read();
    if (!isReadResult(next))
      throw new OpenCodeCatalogError('OpenCode provider response stream is invalid.');
    if (next.done) return size;
    const chunk = next.value;
    const nextSize = size + chunk.byteLength;
    if (nextSize > maximumProviderResponseBytes)
      throw new OpenCodeCatalogError('OpenCode provider response exceeds the size limit.');
    chunks.push(chunk);
    return readChunks(nextSize);
  };
  try {
    const size = await readChunks(0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new OpenCodeCatalogError('OpenCode provider response is not valid JSON.');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

const findAddress = (text: string): string | undefined => {
  const addressPattern = /https?:\/\/127\.0\.0\.1:(\d+)/u;
  const match = addressPattern.exec(text);
  return match === null ? undefined : `http://127.0.0.1:${match[1]}`;
};

interface StartedServer {
  readonly process: ConfigurationServerProcess;
  readonly baseUrl: string;
  readonly output: ReturnType<typeof createBoundedOutput>;
  readonly authorization?: string;
}

const startServer = async (
  processes: ConfigurationServerSpawner,
  request: ConfigurationInspectionRequest,
  deadline: ConfigurationDeadline,
): Promise<StartedServer> => {
  const output = createBoundedOutput({
    maxBytes: maximumServerOutputBytes,
    secrets: request.redactionSecrets,
  });
  let buffer = '';
  let resolveAddress: ((value: string) => void) | undefined;
  const address = new Promise<string>((resolve) => {
    resolveAddress = resolve;
  });
  const environment = launchEnvironment(request.definition, request.environment);
  const password = environment.OPENCODE_SERVER_PASSWORD;
  const authorization =
    password === undefined
      ? undefined
      : `Basic ${globalThis.btoa(`${environment.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${password}`)}`;
  let process: ConfigurationServerProcess;
  try {
    process = await processes.start(
      {
        args: serverArgs,
        command: request.launch.executable,
        cwd: request.workspace,
        environment,
        onStdout: (chunk) => {
          output.write(chunk);
          const text = new TextDecoder().decode(chunk, { stream: true });
          buffer = (buffer + text).slice(-maximumServerOutputBytes);
          const found = findAddress(buffer);
          if (found !== undefined) resolveAddress?.(found);
        },
      },
      deadline.signal,
    );
  } catch (error) {
    if (error instanceof ConfigurationServerStartError && error.cleanupUncertain)
      throw new OpenCodeCatalogError('OpenCode HTTP startup cleanup was not confirmed.', true);
    throw error;
  }
  deadline.activity();
  try {
    const baseUrl = await Promise.race([
      address,
      process.completion.then(() => {
        throw new OpenCodeCatalogError('OpenCode HTTP server exited before readiness.');
      }),
      deadline.completion().then((status) => {
        throw new OpenCodeCatalogError(`OpenCode HTTP server ${status}.`);
      }),
    ]);
    return {
      baseUrl,
      output,
      process,
      ...(authorization === undefined ? {} : { authorization }),
    };
  } catch (error) {
    const cleanup = await process.terminateAndReap();
    output.finalize();
    if (cleanup.status !== 'confirmed')
      throw new OpenCodeCatalogError('OpenCode HTTP startup cleanup was not confirmed.', true);
    throw error;
  }
};

const stopServer = async (server: StartedServer): Promise<void> => {
  const cleanup = await server.process.terminateAndReap();
  server.output.finalize();
  if (cleanup.status !== 'confirmed')
    throw new OpenCodeCatalogError('OpenCode HTTP cleanup was not confirmed.', true);
};

const enrich = async (
  processes: ConfigurationServerSpawner,
  catalog: NormalizedAcpConfiguration,
  request: ConfigurationInspectionRequest,
  deadline: ConfigurationDeadline,
): Promise<NormalizedAcpConfiguration> => {
  let server: StartedServer | undefined;
  try {
    server = await startServer(processes, request, deadline);
    deadline.activity();
    const response = await fetch(`${server.baseUrl}/provider`, {
      ...(server.authorization === undefined
        ? {}
        : { headers: { authorization: server.authorization } }),
      signal: deadline.signal,
    });
    if (!response.ok)
      throw new OpenCodeCatalogError(`OpenCode provider request failed (${response.status}).`);
    const providers = parseOpenCodeProviderCatalog(await readResponse(response, deadline.signal));
    const model =
      catalog.model === undefined ? undefined : Object.freeze({ ...catalog.model, providers });
    return Object.freeze({
      ...catalog,
      ...(model === undefined ? {} : { model }),
    });
  } finally {
    if (server !== undefined) await stopServer(server);
  }
};

export const createOpenCodeCatalogEnricher = (
  processes: ConfigurationServerSpawner,
): ConfigurationCatalogEnricher =>
  Object.freeze({
    enrich: (
      catalog: NormalizedAcpConfiguration,
      request: ConfigurationInspectionRequest,
      deadline: ConfigurationDeadline,
    ) => enrich(processes, catalog, request, deadline),
  });
