type JsonScalar = null | boolean | number | string;
export type PlainJson = JsonScalar | readonly PlainJson[] | PlainJsonObject;
export interface PlainJsonObject {
  readonly [key: string]: PlainJson;
}

const maximumSnapshotNodes = 65_536;

interface SnapshotTask {
  readonly key: string;
  readonly parent: PlainJson[] | Record<string, PlainJson>;
  readonly source: unknown;
}

interface FreezeTask {
  readonly container: PlainJson[] | Record<string, PlainJson>;
  readonly source: object;
}

type Task = SnapshotTask | FreezeTask;

const isFreezeTask = (task: Task): task is FreezeTask => 'container' in task;

const jsonStringBytes = (value: string): number | undefined => {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return undefined;
    if (codePoint === 0x22 || codePoint === 0x5c) bytes += 2;
    else if (
      codePoint === 0x08 ||
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0c ||
      codePoint === 0x0d
    )
      bytes += 2;
    else if (codePoint <= 0x1f) bytes += 6;
    else if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
    if (codePoint > 0xffff) index += 1;
  }
  return bytes;
};

const encodedJsonBytes = (value: JsonScalar): number | undefined => {
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  if (typeof value === 'string') return jsonStringBytes(value);
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  return String(Object.is(value, -0) ? 0 : value).length;
};

const isJsonScalar = (value: unknown): value is JsonScalar =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'number' ||
  typeof value === 'string';

const plainPrototype = (value: object): boolean => {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const dataEntries = (value: object): readonly (readonly [string, unknown])[] | undefined => {
  if (!plainPrototype(value)) return undefined;
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
    entries.push([key, descriptor.value]);
  }
  return entries;
};

const denseArrayValues = (value: readonly unknown[]): readonly unknown[] | undefined => {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length: unknown = lengthDescriptor!.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes('length')) return undefined;
  const keySet = new Set(keys);
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    if (!keySet.has(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
    values.push(descriptor.value);
  }
  return values;
};

const assign = (
  parent: PlainJson[] | Record<string, PlainJson>,
  key: string,
  value: PlainJson,
): void => {
  Object.defineProperty(parent, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
};

const snapshotScalar = (task: SnapshotTask, reserve: (next: number) => void): boolean => {
  if (!isJsonScalar(task.source)) return false;
  const scalarBytes = encodedJsonBytes(task.source);
  if (scalarBytes === undefined) throw new TypeError('Invalid plain JSON scalar.');
  reserve(scalarBytes);
  assign(task.parent, task.key, task.source);
  return true;
};

const queueArraySnapshot = (
  task: SnapshotTask,
  source: readonly unknown[],
  tasks: Task[],
  reserve: (next: number) => void,
): void => {
  const values = denseArrayValues(source);
  if (values === undefined) throw new TypeError('Invalid plain JSON array.');
  reserve(2 + Math.max(0, values.length - 1));
  const target: PlainJson[] = [];
  assign(task.parent, task.key, target);
  tasks.push({ container: target, source });
  for (let index = values.length - 1; index >= 0; index -= 1)
    tasks.push({
      key: String(index),
      parent: target,
      source: values[index],
    });
};

const queueObjectSnapshot = (
  task: SnapshotTask,
  source: object,
  tasks: Task[],
  reserve: (next: number) => void,
): void => {
  const entries = dataEntries(source);
  if (entries === undefined) throw new TypeError('Invalid plain JSON object.');
  reserve(2 + Math.max(0, entries.length - 1));
  const target: Record<string, PlainJson> = {};
  assign(task.parent, task.key, target);
  tasks.push({ container: target, source });
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [key, value] = entries[index]!;
    const keyBytes = encodedJsonBytes(key);
    if (keyBytes === undefined) throw new TypeError('Invalid plain JSON key.');
    reserve(keyBytes + 1);
    tasks.push({ key, parent: target, source: value });
  }
};

export const snapshotPlainJson = (source: unknown, maximumBytes: number): PlainJson => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new TypeError('Invalid plain JSON byte limit.');
  const root: Record<string, PlainJson> = {};
  const active = new WeakSet<object>();
  const tasks: Task[] = [{ key: 'value', parent: root, source }];
  let bytes = 0;
  let nodes = 0;

  const reserve = (next: number): void => {
    bytes += next;
    if (bytes > maximumBytes) throw new TypeError('Plain JSON exceeds its byte limit.');
  };

  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (isFreezeTask(task)) {
      active.delete(task.source);
      Object.freeze(task.container);
      continue;
    }
    nodes += 1;
    if (nodes > maximumSnapshotNodes)
      throw new TypeError('Plain JSON exceeds its structural limit.');
    if (snapshotScalar(task, reserve)) continue;
    if (typeof task.source !== 'object' || task.source === null || active.has(task.source))
      throw new TypeError('Invalid plain JSON value.');
    active.add(task.source);

    if (Array.isArray(task.source)) {
      queueArraySnapshot(task, task.source, tasks, reserve);
      continue;
    }

    queueObjectSnapshot(task, task.source, tasks, reserve);
  }
  return root.value!;
};

export const snapshotPlainJsonObject = (source: unknown, maximumBytes: number): PlainJsonObject => {
  const snapshot = snapshotPlainJson(source, maximumBytes);
  if (!isPlainJsonObject(snapshot)) throw new TypeError('Plain JSON object required.');
  return snapshot;
};

const isPlainJsonObject = (value: PlainJson): value is PlainJsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
