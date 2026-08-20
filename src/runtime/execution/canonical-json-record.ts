import type { JsonObject } from '../spec/index.js';
import { reflectiveObjectRead } from './reflective-object-read.js';

const { isPlainObservedObject, isDataDescriptor, ownEnumerableData, enumerableKeys } =
  reflectiveObjectRead;

interface MutableRecord {
  [key: string]: MutableJson;
}
type MutableJson = null | boolean | number | string | MutableJson[] | MutableRecord;
type MutableContainer = MutableJson[] | MutableRecord;

interface ObjectFrame {
  readonly activeSource: object;
  readonly depth: number;
  readonly kind: 'object';
  readonly source: object;
  readonly target: MutableRecord;
  readonly iterator: Iterator<string>;
  entries: number;
}

interface ArrayFrame {
  readonly activeSource: object;
  readonly depth: number;
  readonly kind: 'array';
  readonly source: readonly unknown[];
  readonly target: MutableJson[];
  entries: number;
  readonly length: number;
  index: number;
  validatedEnumerableKeys: boolean;
}

type CopyFrame = ObjectFrame | ArrayFrame;
type FrameStep =
  | Readonly<{ status: 'entry'; key: string; value: unknown }>
  | Readonly<{ status: 'complete' }>
  | Readonly<{ status: 'invalid' }>;

interface CopyState {
  readonly active: WeakSet<object>;
  readonly maximumBytes: number;
  readonly frames: CopyFrame[];
  bytes: number;
  entries: number;
  values: number;
}

const encoder = new TextEncoder();
const maximumTraversalValues = 65_536;
const maximumTraversalDepth = 65_536;

const isScalar = (value: unknown): value is null | boolean | number | string =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  typeof value === 'number';

const createRecord = (): MutableRecord => {
  const record: MutableRecord = {};
  Object.setPrototypeOf(record, null);
  return record;
};

const codePointAt = (value: string, index: number): number | undefined => {
  const codePoint = value.codePointAt(index);
  if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return undefined;
  return codePoint;
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

const appendProperty = (target: MutableContainer, key: string, value: MutableJson): void => {
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
    const target: MutableJson[] = [];
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

const copyRecord = (source: unknown, maximumBytes: number): JsonObject | undefined => {
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

export const canonicalJsonRecord = Object.freeze({
  copy: copyRecord,
});
