import { AGENT_MANAGER_LIMITS, AGENT_RUNTIME_LIMITS } from '../policy/index.js';
import type { AgentRef } from '../spec/index.js';
import { reflectiveObjectRead } from './reflective-object-read.js';

const { isPlainObservedObject, isDataDescriptor, ownEnumerableData, enumerableKeys } =
  reflectiveObjectRead;

const maximumInvocationIdBytes = 256;
const maximumWorkspacePathBytes = AGENT_RUNTIME_LIMITS.workspacePathBytes;
const maximumOutputPathBytes = AGENT_RUNTIME_LIMITS.outputPathBytes;
const maximumPromptBytes = AGENT_RUNTIME_LIMITS.promptBytes;
const maximumMetadataBytes = AGENT_RUNTIME_LIMITS.invocationMetadataBytes;
const maximumParametersBytes = AGENT_RUNTIME_LIMITS.parameterBytes;
const maximumPermissionsBytes = AGENT_RUNTIME_LIMITS.permissionBytes;
const maximumTraversalValues = 65_536;
const maximumTraversalDepth = 65_536;

interface SnapshotRecord {
  readonly [key: string]: SnapshotJson;
}
type SnapshotJson = null | boolean | number | string | readonly SnapshotJson[] | SnapshotRecord;
interface MutableSnapshotRecord {
  [key: string]: MutableSnapshotJson;
}
type MutableSnapshotJson =
  | null
  | boolean
  | number
  | string
  | MutableSnapshotJson[]
  | MutableSnapshotRecord;
type MutableContainer = MutableSnapshotJson[] | MutableSnapshotRecord;

interface ObjectFrame {
  readonly activeSource: object;
  readonly depth: number;
  readonly kind: 'object';
  readonly source: object;
  readonly target: MutableSnapshotRecord;
  readonly iterator: Iterator<string>;
  entries: number;
}

interface ArrayFrame {
  readonly activeSource: object;
  readonly depth: number;
  readonly kind: 'array';
  readonly source: readonly unknown[];
  readonly target: MutableSnapshotJson[];
  entries: number;
  readonly length: number;
  index: number;
  validatedEnumerableKeys: boolean;
}

type CopyFrame = ObjectFrame | ArrayFrame;

const encoder = new TextEncoder();

const isScalar = (value: unknown): value is null | boolean | number | string =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  typeof value === 'number';

const createRecord = (): MutableSnapshotRecord => {
  const record: MutableSnapshotRecord = {};
  Object.setPrototypeOf(record, null);
  return record;
};

const codePointAt = (value: string, index: number): number | undefined => {
  const codePoint = value.codePointAt(index);
  if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined;
  return codePoint;
};

const validString = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = codePointAt(value, index);
    if (codePoint === undefined) return false;
    if (codePoint > 0xffff) index += 1;
  }
  return true;
};

const jsonCodePointBytes = (codePoint: number): number => {
  if (codePoint === 0x22 || codePoint === 0x5c) return 2;
  if (
    codePoint === 0x08 ||
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0c ||
    codePoint === 0x0d
  )
    return 2;
  if (codePoint <= 0x1f) return 6;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const jsonStringBytes = (value: string, remaining: number): number | undefined => {
  let bytes = 2;
  if (bytes > remaining) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = codePointAt(value, index);
    if (codePoint === undefined) return undefined;
    bytes += jsonCodePointBytes(codePoint);
    if (bytes > remaining) return undefined;
    if (codePoint > 0xffff) index += 1;
  }
  return bytes;
};

const scalarJsonBytes = (
  value: null | boolean | number | string,
  remaining: number,
): number | undefined => {
  if (typeof value === 'string') return jsonStringBytes(value, remaining);
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  let text: string;
  if (value === null) text = 'null';
  else if (typeof value === 'boolean') text = String(value);
  else text = Object.is(value, -0) ? '0' : String(value);
  const bytes = encoder.encode(text).byteLength;
  return bytes <= remaining ? bytes : undefined;
};

const appendProperty = (
  target: MutableContainer,
  key: string,
  value: MutableSnapshotJson,
): void => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: false,
    writable: false,
  });
};

const inspectArrayLength = (value: readonly unknown[]): number | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!isDataDescriptor(descriptor)) return undefined;
  const length = descriptor.value;
  if (typeof length !== 'number') return undefined;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumTraversalValues)
    return undefined;
  return length;
};

interface CopyState {
  readonly active: WeakSet<object>;
  readonly maximumBytes: number;
  readonly frames: CopyFrame[];
  bytes: number;
  entries: number;
  values: number;
}

type FrameStep =
  | Readonly<{ status: 'entry'; key: string; value: unknown }>
  | Readonly<{ status: 'complete' }>
  | Readonly<{ status: 'invalid' }>;

const validateDenseArrayKeys = (frame: ArrayFrame): boolean => {
  let observed = 0;
  for (const key of enumerableKeys(frame.source)) {
    observed += 1;
    if (
      observed > frame.length ||
      key !== String(observed - 1) ||
      !ownEnumerableData(frame.source, key).valid
    )
      return false;
  }
  return true;
};

const nextFrameEntry = (frame: CopyFrame): FrameStep => {
  if (frame.kind === 'object') {
    const next = frame.iterator.next();
    if (next.done) return Object.freeze({ status: 'complete' });
    const read = ownEnumerableData(frame.source, next.value);
    return read.valid
      ? Object.freeze({ status: 'entry', key: next.value, value: read.value })
      : Object.freeze({ status: 'invalid' });
  }
  if (frame.index >= frame.length) {
    if (!frame.validatedEnumerableKeys && !validateDenseArrayKeys(frame))
      return Object.freeze({ status: 'invalid' });
    frame.validatedEnumerableKeys = true;
    return Object.freeze({ status: 'complete' });
  }
  const key = String(frame.index);
  const read = ownEnumerableData(frame.source, key);
  if (!read.valid) return Object.freeze({ status: 'invalid' });
  frame.index += 1;
  return Object.freeze({ status: 'entry', key, value: read.value });
};

const closeFrame = (state: CopyState): boolean => {
  const frame = state.frames.at(-1);
  if (frame === undefined) return false;
  state.bytes += 1;
  if (state.bytes > state.maximumBytes) return false;
  Object.freeze(frame.target);
  state.active.delete(frame.activeSource);
  state.frames.pop();
  return true;
};

const reserveEntry = (state: CopyState, frame: CopyFrame, key: string): boolean => {
  frame.entries += 1;
  state.entries += 1;
  state.values += 1;
  if (
    frame.entries > maximumTraversalValues ||
    state.entries > maximumTraversalValues ||
    state.values > maximumTraversalValues
  )
    return false;
  if (frame.entries > 1) state.bytes += 1;
  if (frame.kind === 'object') {
    const keyBytes = jsonStringBytes(key, state.maximumBytes - state.bytes);
    if (keyBytes === undefined) return false;
    state.bytes += keyBytes + 1;
  }
  return state.bytes <= state.maximumBytes;
};

const createChildFrame = (
  value: object,
  depth: number,
): Readonly<{ frame: CopyFrame; target: MutableContainer }> | undefined => {
  if (Array.isArray(value)) {
    const length = inspectArrayLength(value);
    if (length === undefined) return undefined;
    const target: MutableSnapshotJson[] = [];
    return Object.freeze({
      target,
      frame: {
        activeSource: value,
        depth,
        kind: 'array',
        source: value,
        target,
        entries: 0,
        length,
        index: 0,
        validatedEnumerableKeys: false,
      },
    });
  }
  if (!isPlainObservedObject(value)) return undefined;
  const target = createRecord();
  return Object.freeze({
    target,
    frame: {
      activeSource: value,
      depth,
      kind: 'object',
      source: value,
      target,
      iterator: enumerableKeys(value),
      entries: 0,
    },
  });
};

const appendEntry = (
  state: CopyState,
  frame: CopyFrame,
  entry: Extract<FrameStep, { status: 'entry' }>,
): boolean => {
  if (!reserveEntry(state, frame, entry.key)) return false;
  if (isScalar(entry.value)) {
    const scalarBytes = scalarJsonBytes(entry.value, state.maximumBytes - state.bytes);
    if (scalarBytes === undefined) return false;
    state.bytes += scalarBytes;
    appendProperty(frame.target, entry.key, entry.value);
    return true;
  }
  if (
    typeof entry.value !== 'object' ||
    entry.value === null ||
    state.active.has(entry.value) ||
    frame.depth >= maximumTraversalDepth
  )
    return false;
  const child = createChildFrame(entry.value, frame.depth + 1);
  if (child === undefined) return false;
  state.bytes += 1;
  if (state.bytes > state.maximumBytes) return false;
  appendProperty(frame.target, entry.key, child.target);
  state.active.add(entry.value);
  state.frames.push(child.frame);
  return true;
};

const copyMetadata = (
  source: unknown,
  maximumBytes: number = maximumMetadataBytes,
): SnapshotRecord | undefined => {
  try {
    if (
      typeof source !== 'object' ||
      source === null ||
      Array.isArray(source) ||
      !isPlainObservedObject(source)
    )
      return undefined;
    const root = createRecord();
    const state: CopyState = {
      active: new WeakSet<object>([source]),
      frames: [
        {
          activeSource: source,
          depth: 1,
          kind: 'object',
          source,
          target: root,
          iterator: enumerableKeys(source),
          entries: 0,
        },
      ],
      bytes: 1,
      maximumBytes,
      entries: 0,
      values: 1,
    };
    while (state.frames.length > 0) {
      const frame = state.frames.at(-1);
      if (frame === undefined) return undefined;
      const step = nextFrameEntry(frame);
      if (step.status === 'invalid') return undefined;
      if (step.status === 'complete') {
        if (!closeFrame(state)) return undefined;
        continue;
      }
      if (!appendEntry(state, frame, step)) return undefined;
    }
    return root;
  } catch {
    return undefined;
  }
};

const requestKeys = Object.freeze([
  'invocationId',
  'agent',
  'prompt',
  'workspace',
  'parameters',
  'permissions',
  'metadata',
  'result',
  'limits',
  'output',
]);

const readRequest = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !isPlainObservedObject(value)
    )
      return undefined;
    const input: Record<string, unknown> = {};
    const keys = Reflect.ownKeys(value);
    if (keys.length > requestKeys.length) return undefined;
    for (const key of keys) {
      if (typeof key !== 'string' || !requestKeys.includes(key)) return undefined;
      const read = ownEnumerableData(value, key);
      if (!read.valid) return undefined;
      input[key] = read.value;
    }
    return input;
  } catch {
    return undefined;
  }
};

const copyAgentRef = (value: unknown): AgentRef | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('version')) return undefined;
  const id = Object.getOwnPropertyDescriptor(value, 'id');
  const version = Object.getOwnPropertyDescriptor(value, 'version');
  if (
    id === undefined ||
    version === undefined ||
    !('value' in id) ||
    !('value' in version) ||
    !id.enumerable ||
    !version.enumerable ||
    typeof id.value !== 'string' ||
    typeof version.value !== 'string' ||
    id.value.length === 0 ||
    version.value.length === 0 ||
    id.value.length > maximumInvocationIdBytes ||
    version.value.length > maximumInvocationIdBytes ||
    !validString(id.value) ||
    !validString(version.value) ||
    encoder.encode(id.value).byteLength > maximumInvocationIdBytes ||
    encoder.encode(version.value).byteLength > maximumInvocationIdBytes
  )
    return undefined;
  return Object.freeze({ id: id.value, version: version.value });
};

const copyDirectory = (value: unknown, maximumBytes: number): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || !keys.includes('directory')) return undefined;
  const directory = Object.getOwnPropertyDescriptor(value, 'directory');
  if (
    directory === undefined ||
    !directory.enumerable ||
    !('value' in directory) ||
    typeof directory.value !== 'string' ||
    directory.value.length === 0 ||
    encoder.encode(directory.value).byteLength > maximumBytes ||
    !validString(directory.value)
  )
    return undefined;
  return directory.value;
};

const copyPrompt = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0 || !validString(value)) return undefined;
  return encoder.encode(value).byteLength <= maximumPromptBytes ? value : undefined;
};

const copyResultSchema = (value: unknown): SnapshotRecord | undefined =>
  value === undefined
    ? undefined
    : copyMetadata(value, AGENT_MANAGER_LIMITS.maxRawResponseBytes.default);

const readResultSchema = (input: Readonly<Record<string, unknown>>): SnapshotRecord | undefined => {
  if (typeof input.result !== 'object' || input.result === null || Array.isArray(input.result))
    return undefined;
  const keys = Reflect.ownKeys(input.result);
  if (keys.length !== 1 || !keys.includes('schema')) return undefined;
  const schema = Object.getOwnPropertyDescriptor(input.result, 'schema');
  if (schema === undefined || !schema.enumerable || !('value' in schema)) return undefined;
  return copyResultSchema(schema.value);
};

interface InvocationLimitDefaults {
  readonly wallClockTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxEventBytes?: number;
  readonly maxEventsFileBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxRawResponseBytes?: number;
}

interface InvocationEffectiveLimits {
  readonly wallClockTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxEventBytes: number;
  readonly maxEventsFileBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxRawResponseBytes: number;
}

const limitKeys = Object.freeze([
  'wallClockTimeoutMs',
  'idleTimeoutMs',
  'maxEventBytes',
  'maxEventsFileBytes',
  'maxStdoutBytes',
  'maxStderrBytes',
  'maxRawResponseBytes',
]);

const optionalLimit = (limits: object, key: string): number | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(limits, key);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !('value' in descriptor)) return Number.NaN;
  return typeof descriptor.value === 'number' && Number.isSafeInteger(descriptor.value)
    ? descriptor.value
    : Number.NaN;
};

const defaultEffectiveLimits = Object.freeze({
  wallClockTimeoutMs: AGENT_MANAGER_LIMITS.wallClockTimeoutMs.default,
  idleTimeoutMs: AGENT_MANAGER_LIMITS.idleTimeoutMs.default,
  maxEventBytes: AGENT_MANAGER_LIMITS.maxEventBytes.default,
  maxEventsFileBytes: AGENT_MANAGER_LIMITS.maxEventsFileBytes.default,
  maxStdoutBytes: AGENT_MANAGER_LIMITS.maxStdoutBytes.default,
  maxStderrBytes: AGENT_MANAGER_LIMITS.maxStderrBytes.default,
  maxRawResponseBytes: AGENT_MANAGER_LIMITS.maxRawResponseBytes.default,
});

const createEffectiveLimits = (
  value: unknown,
  managerLimits: InvocationLimitDefaults = defaultEffectiveLimits,
): InvocationEffectiveLimits | undefined => {
  if (value !== undefined) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !limitKeys.includes(key))) return undefined;
  }
  const source = value;
  const limit = (
    key: keyof InvocationEffectiveLimits,
    range: Readonly<{ minimum: number; default: number; maximum: number }>,
  ): number | undefined => {
    const next = source === undefined ? undefined : optionalLimit(source, key);
    const managerDefault = managerLimits[key];
    if (
      managerDefault === undefined ||
      !Number.isSafeInteger(managerDefault) ||
      managerDefault < range.minimum ||
      managerDefault > range.maximum
    )
      return undefined;
    if (next === undefined) return managerDefault;
    if (!Number.isSafeInteger(next) || next < range.minimum || next > managerDefault)
      return undefined;
    return next;
  };
  const wallClockTimeoutMs = limit('wallClockTimeoutMs', AGENT_MANAGER_LIMITS.wallClockTimeoutMs);
  const idleTimeoutMs = limit('idleTimeoutMs', AGENT_MANAGER_LIMITS.idleTimeoutMs);
  const maxEventBytes = limit('maxEventBytes', AGENT_MANAGER_LIMITS.maxEventBytes);
  const maxEventsFileBytes = limit(
    'maxEventsFileBytes',
    Object.freeze({
      minimum:
        AGENT_MANAGER_LIMITS.maxTerminalEventBytes + AGENT_MANAGER_LIMITS.maxEventBytes.minimum + 2,
      default: AGENT_MANAGER_LIMITS.maxEventsFileBytes.default,
      maximum: AGENT_MANAGER_LIMITS.maxEventsFileBytes.maximum,
    }),
  );
  const maxStdoutBytes = limit('maxStdoutBytes', AGENT_MANAGER_LIMITS.maxStdoutBytes);
  const maxStderrBytes = limit('maxStderrBytes', AGENT_MANAGER_LIMITS.maxStderrBytes);
  const maxRawResponseBytes = limit(
    'maxRawResponseBytes',
    AGENT_MANAGER_LIMITS.maxRawResponseBytes,
  );
  if (
    wallClockTimeoutMs === undefined ||
    idleTimeoutMs === undefined ||
    maxEventBytes === undefined ||
    maxEventsFileBytes === undefined ||
    maxStdoutBytes === undefined ||
    maxStderrBytes === undefined ||
    maxRawResponseBytes === undefined ||
    idleTimeoutMs > wallClockTimeoutMs ||
    maxEventsFileBytes < AGENT_MANAGER_LIMITS.maxTerminalEventBytes + maxEventBytes + 2
  )
    return undefined;
  return Object.freeze({
    wallClockTimeoutMs,
    idleTimeoutMs,
    maxEventBytes,
    maxEventsFileBytes,
    maxStdoutBytes,
    maxStderrBytes,
    maxRawResponseBytes,
  });
};

export class InvocationInputSnapshot {
  readonly agent: AgentRef | undefined;
  readonly invocationId: string;
  readonly limits: InvocationEffectiveLimits;
  readonly metadata: SnapshotRecord | undefined;
  readonly outputDirectory: string | undefined;
  readonly parameters: SnapshotRecord | undefined;
  readonly permissions: SnapshotRecord | undefined;
  readonly prompt: string | undefined;
  readonly resultSchema: SnapshotRecord;
  readonly wallClockTimeoutMs: number;
  readonly workspace: string | undefined;

  private constructor(
    input: Readonly<{
      agent: AgentRef | undefined;
      invocationId: string;
      limits: InvocationEffectiveLimits;
      metadata: SnapshotRecord | undefined;
      outputDirectory: string | undefined;
      parameters: SnapshotRecord | undefined;
      permissions: SnapshotRecord | undefined;
      prompt: string | undefined;
      resultSchema: SnapshotRecord;
      wallClockTimeoutMs: number;
      workspace: string | undefined;
    }>,
  ) {
    this.agent = input.agent;
    this.invocationId = input.invocationId;
    this.limits = input.limits;
    this.metadata = input.metadata;
    this.outputDirectory = input.outputDirectory;
    this.parameters = input.parameters;
    this.permissions = input.permissions;
    this.prompt = input.prompt;
    this.resultSchema = input.resultSchema;
    this.wallClockTimeoutMs = input.wallClockTimeoutMs;
    this.workspace = input.workspace;
    Object.freeze(this);
  }

  static create(
    value: unknown,
    managerLimits: InvocationLimitDefaults = defaultEffectiveLimits,
  ): InvocationInputSnapshot | undefined {
    const input = readRequest(value);
    if (
      input === undefined ||
      typeof input.invocationId !== 'string' ||
      input.invocationId.length === 0
    )
      return undefined;
    if (input.invocationId.length > maximumInvocationIdBytes) return undefined;
    if (
      !validString(input.invocationId) ||
      encoder.encode(input.invocationId).byteLength > maximumInvocationIdBytes
    )
      return undefined;
    const agent = copyAgentRef(input.agent);
    if (agent === undefined) return undefined;
    const metadata = input.metadata === undefined ? undefined : copyMetadata(input.metadata);
    if (input.metadata !== undefined && metadata === undefined) return undefined;
    const prompt = copyPrompt(input.prompt);
    if (prompt === undefined) return undefined;
    const parameters = copyMetadata(input.parameters, maximumParametersBytes);
    if (parameters === undefined) return undefined;
    const permissions = copyMetadata(input.permissions, maximumPermissionsBytes);
    if (permissions === undefined) return undefined;
    const resultSchema = readResultSchema(input);
    if (resultSchema === undefined) return undefined;
    const limits = createEffectiveLimits(input.limits, managerLimits);
    if (limits === undefined) return undefined;
    const workspace = copyDirectory(input.workspace, maximumWorkspacePathBytes);
    if (workspace === undefined) return undefined;
    const outputDirectory = copyDirectory(input.output, maximumOutputPathBytes);
    if (outputDirectory === undefined) return undefined;
    return new InvocationInputSnapshot(
      Object.freeze({
        agent,
        invocationId: input.invocationId,
        limits,
        metadata,
        outputDirectory,
        parameters,
        permissions,
        prompt,
        resultSchema,
        wallClockTimeoutMs: limits.wallClockTimeoutMs,
        workspace,
      }),
    );
  }
}
