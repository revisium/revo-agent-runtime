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

const validString = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

const jsonStringBytes = (value: string, remaining: number): number | undefined => {
  let bytes = 2;
  if (bytes > remaining) return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let added: number;
    if (code === 0x22 || code === 0x5c) added = 2;
    else if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d)
      added = 2;
    else if (code <= 0x1f) added = 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return undefined;
      added = 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return undefined;
    else if (code <= 0x7f) added = 1;
    else if (code <= 0x7ff) added = 2;
    else added = 3;
    bytes += added;
    if (bytes > remaining) return undefined;
  }
  return bytes;
};

const scalarJsonBytes = (
  value: null | boolean | number | string,
  remaining: number,
): number | undefined => {
  if (typeof value === 'string') return jsonStringBytes(value, remaining);
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  const text =
    value === null
      ? 'null'
      : typeof value === 'boolean'
        ? String(value)
        : Object.is(value, -0)
          ? '0'
          : String(value);
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
    const active = new WeakSet<object>([source]);
    const frames: CopyFrame[] = [
      {
        activeSource: source,
        depth: 1,
        kind: 'object',
        source,
        target: root,
        iterator: enumerableKeys(source),
        entries: 0,
      },
    ];
    let bytes = 1;
    let values = 1;
    let entries = 0;

    while (frames.length > 0) {
      const frame = frames.at(-1);
      if (frame === undefined) return undefined;
      let key: string;
      let value: unknown;
      if (frame.kind === 'object') {
        const next = frame.iterator.next();
        if (!next.done) {
          key = next.value;
          const read = ownEnumerableData(frame.source, key);
          if (!read.valid) return undefined;
          value = read.value;
        } else {
          bytes += 1;
          if (bytes > maximumMetadataBytes) return undefined;
          Object.freeze(frame.target);
          active.delete(frame.activeSource);
          frames.pop();
          continue;
        }
      } else if (frame.index < frame.length) {
        key = String(frame.index);
        const read = ownEnumerableData(frame.source, key);
        if (!read.valid) return undefined;
        value = read.value;
        frame.index += 1;
      } else {
        if (!frame.validatedEnumerableKeys) {
          let observed = 0;
          for (const observedKey of enumerableKeys(frame.source)) {
            observed += 1;
            if (
              observed > frame.length ||
              observedKey !== String(observed - 1) ||
              !ownEnumerableData(frame.source, observedKey).valid
            )
              return undefined;
          }
          frame.validatedEnumerableKeys = true;
        }
        bytes += 1;
        if (bytes > maximumMetadataBytes) return undefined;
        Object.freeze(frame.target);
        active.delete(frame.activeSource);
        frames.pop();
        continue;
      }
      frame.entries += 1;
      entries += 1;
      values += 1;
      if (
        frame.entries > maximumTraversalValues ||
        entries > maximumTraversalValues ||
        values > maximumTraversalValues
      )
        return undefined;
      if (frame.entries > 1) {
        bytes += 1;
        if (bytes > maximumMetadataBytes) return undefined;
      }
      if (frame.kind === 'object') {
        const keyBytes = jsonStringBytes(key, maximumMetadataBytes - bytes);
        if (keyBytes === undefined) return undefined;
        bytes += keyBytes + 1;
        if (bytes > maximumMetadataBytes) return undefined;
      }

      if (isScalar(value)) {
        const scalarBytes = scalarJsonBytes(value, maximumMetadataBytes - bytes);
        if (scalarBytes === undefined) return undefined;
        bytes += scalarBytes;
        appendProperty(frame.target, key, value);
        continue;
      }
      if (
        typeof value !== 'object' ||
        value === null ||
        active.has(value) ||
        frame.depth >= maximumTraversalDepth
      )
        return undefined;

      let target: MutableContainer;
      let child: CopyFrame;
      if (Array.isArray(value)) {
        const length = inspectArrayLength(value);
        if (length === undefined) return undefined;
        target = [];
        child = {
          activeSource: value,
          depth: frame.depth + 1,
          kind: 'array',
          source: value,
          target,
          entries: 0,
          length,
          index: 0,
          validatedEnumerableKeys: false,
        };
      } else {
        if (!isPlainObservedObject(value)) return undefined;
        target = createRecord();
        child = {
          activeSource: value,
          depth: frame.depth + 1,
          kind: 'object',
          source: value,
          target,
          iterator: enumerableKeys(value),
          entries: 0,
        };
      }
      bytes += 1;
      if (bytes > maximumMetadataBytes) return undefined;
      appendProperty(frame.target, key, target);
      active.add(value);
      frames.push(child);
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
