import { AGENT_MANAGER_LIMITS } from '../policy/index.js';

const maximumInvocationIdBytes = 256;
const maximumMetadataBytes = 65_536;
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

const enumerableKeys = function* (value: object): Generator<string> {
  for (const key in value) yield key;
};

const isPlainObservedObject = (value: object): boolean => {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

type OwnDataRead = Readonly<{ valid: true; value: unknown }> | Readonly<{ valid: false }>;
interface DataDescriptor {
  readonly value: unknown;
}
interface EnumerableDataDescriptor extends DataDescriptor {
  readonly enumerable: true;
}

const isEnumerableDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is EnumerableDataDescriptor =>
  descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');

const isDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is DataDescriptor => descriptor !== undefined && Object.hasOwn(descriptor, 'value');

const ownEnumerableData = (value: object, key: string): OwnDataRead => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isEnumerableDataDescriptor(descriptor)) return Object.freeze({ valid: false });
  return Object.freeze({ valid: true, value: descriptor.value });
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
  if (state.bytes > maximumMetadataBytes) return false;
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
    const keyBytes = jsonStringBytes(key, maximumMetadataBytes - state.bytes);
    if (keyBytes === undefined) return false;
    state.bytes += keyBytes + 1;
  }
  return state.bytes <= maximumMetadataBytes;
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
    const scalarBytes = scalarJsonBytes(entry.value, maximumMetadataBytes - state.bytes);
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
  if (state.bytes > maximumMetadataBytes) return false;
  appendProperty(frame.target, entry.key, child.target);
  state.active.add(entry.value);
  state.frames.push(child.frame);
  return true;
};

const copyMetadata = (source: unknown): SnapshotRecord | undefined => {
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
    let entries = 0;
    for (const key in value) {
      entries += 1;
      if (
        entries > 3 ||
        (key !== 'invocationId' && key !== 'metadata' && key !== 'wallClockTimeoutMs')
      )
        return undefined;
      const read = ownEnumerableData(value, key);
      if (!read.valid) return undefined;
      input[key] = read.value;
    }
    return input;
  } catch {
    return undefined;
  }
};

export class InvocationInputSnapshot {
  readonly invocationId: string;
  readonly metadata: SnapshotRecord | undefined;
  readonly wallClockTimeoutMs: number;

  private constructor(
    input: Readonly<{
      invocationId: string;
      metadata: SnapshotRecord | undefined;
      wallClockTimeoutMs: number;
    }>,
  ) {
    this.invocationId = input.invocationId;
    this.metadata = input.metadata;
    this.wallClockTimeoutMs = input.wallClockTimeoutMs;
    Object.freeze(this);
  }

  static create(value: unknown): InvocationInputSnapshot | undefined {
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
    const metadata = input.metadata === undefined ? undefined : copyMetadata(input.metadata);
    if (input.metadata !== undefined && metadata === undefined) return undefined;
    const deadline = input.wallClockTimeoutMs ?? AGENT_MANAGER_LIMITS.wallClockTimeoutMs.default;
    if (
      typeof deadline !== 'number' ||
      !Number.isSafeInteger(deadline) ||
      deadline < AGENT_MANAGER_LIMITS.wallClockTimeoutMs.minimum ||
      deadline > AGENT_MANAGER_LIMITS.wallClockTimeoutMs.maximum
    )
      return undefined;
    return new InvocationInputSnapshot(
      Object.freeze({ invocationId: input.invocationId, metadata, wallClockTimeoutMs: deadline }),
    );
  }
}
