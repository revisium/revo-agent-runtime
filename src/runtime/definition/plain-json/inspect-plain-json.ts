import { types as utilTypes } from 'node:util';

import { AgentManagerError } from '../../errors/index.js';
import { AGENT_FAULT_MESSAGES } from '../../policy/index.js';
import type {
  AgentFault,
  AgentValidationDetails,
  AgentValidationDiagnostic,
} from '../../spec/index.js';
import type { PlainJsonInspection } from './plain-json-inspection.js';

const diagnosticMessages = {
  json_array_dense: 'Array must be dense and contain only indexed elements.',
  json_cycle: 'Value must not contain a cycle.',
  json_finite: 'Number must be finite.',
  json_object_plain: 'Object must be a plain JSON object.',
  json_property_data: 'Property must be an own enumerable data property.',
  json_property_key: 'Property keys must be strings.',
  json_type: 'Value must be JSON-compatible.',
  unicode_scalar: 'String must contain paired UTF-16 surrogates.',
} as const;

type PlainJsonKeyword = keyof typeof diagnosticMessages;

interface InspectedProperty {
  readonly path: string;
  readonly value: unknown;
}

interface DataPropertyDescriptor extends PropertyDescriptor {
  readonly enumerable: true;
  readonly value: unknown;
}

interface EnterFrame {
  readonly kind: 'enter';
  readonly value: unknown;
  readonly path: string;
  readonly depth: number;
}

interface ExitFrame {
  readonly kind: 'exit';
  readonly value: object;
}

type TraversalFrame = EnterFrame | ExitFrame;

const escapePointerToken = (token: string): string =>
  token.replaceAll('~', '~0').replaceAll('/', '~1');

const appendPointerToken = (path: string, token: string): string =>
  `${path}/${escapePointerToken(token)}`;

const hasPairedSurrogates = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);

    if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return false;
    if (codePoint > 0xffff) index += 1;
  }

  return true;
};

const createFault = (keyword: PlainJsonKeyword, instancePath: string): AgentFault => {
  const diagnostic: AgentValidationDiagnostic = Object.freeze({
    instancePath,
    instancePathTruncated: false,
    schemaPath: `/${keyword}`,
    schemaPathTruncated: false,
    keyword,
    message: diagnosticMessages[keyword],
  });
  const diagnostics: readonly AgentValidationDiagnostic[] = Object.freeze([diagnostic]);
  const details: AgentValidationDetails = Object.freeze({ diagnostics, truncated: false });

  return Object.freeze({
    code: 'revo.agent.definition_invalid',
    message:
      keyword === 'unicode_scalar'
        ? AGENT_FAULT_MESSAGES.invalidUnicode
        : AGENT_FAULT_MESSAGES.definitionInvalid,
    phase: 'construction',
    retryable: false,
    details,
  });
};

const reject = (keyword: PlainJsonKeyword, instancePath: string): never => {
  throw new AgentManagerError(createFault(keyword, instancePath));
};

const assertScalarString = (value: string, path: string): void => {
  if (!hasPairedSurrogates(value)) reject('unicode_scalar', path);
};

const isEnumerableDataProperty = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is DataPropertyDescriptor =>
  descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');

const inspectPropertyDescriptor = (
  container: object,
  key: string,
  parentPath: string,
): InspectedProperty => {
  if (!hasPairedSurrogates(key)) reject('unicode_scalar', parentPath);

  const path = appendPointerToken(parentPath, key);
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (isEnumerableDataProperty(descriptor)) return { path, value: descriptor.value };

  return reject('json_property_data', path);
};

const inspectObjectShape = (value: object, path: string): readonly InspectedProperty[] => {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) reject('json_object_plain', path);

  const keys = Reflect.ownKeys(value);
  const properties: InspectedProperty[] = [];
  for (const key of keys) {
    if (typeof key === 'string') {
      properties.push(inspectPropertyDescriptor(value, key, path));
      continue;
    }
    reject('json_property_key', path);
  }

  return properties;
};

const isSafeArrayLength = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const inspectArrayShape = (
  value: readonly unknown[],
  path: string,
): readonly InspectedProperty[] => {
  if (Object.getPrototypeOf(value) !== Array.prototype) reject('json_array_dense', path);

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length: unknown = lengthDescriptor?.value;
  if (isSafeArrayLength(length)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys[length] !== 'length') reject('json_array_dense', path);

    const properties: InspectedProperty[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (keys[index] !== key) reject('json_array_dense', path);
      properties.push(inspectPropertyDescriptor(value, key, path));
    }

    return properties;
  }

  return reject('json_array_dense', path);
};

const enterContainer = (
  value: object,
  path: string,
  depth: number,
  activeContainers: WeakSet<object>,
  frames: TraversalFrame[],
): void => {
  if (utilTypes.isProxy(value)) reject('json_object_plain', path);
  if (activeContainers.has(value)) reject('json_cycle', path);

  const properties = Array.isArray(value)
    ? inspectArrayShape(value, path)
    : inspectObjectShape(value, path);

  activeContainers.add(value);
  frames.push({ kind: 'exit', value });
  for (const property of properties.toReversed()) {
    frames.push({ kind: 'enter', value: property.value, path: property.path, depth: depth + 1 });
  }
};

const inspectEnterFrame = (
  frame: EnterFrame,
  activeContainers: WeakSet<object>,
  frames: TraversalFrame[],
): void => {
  const { value, path, depth } = frame;
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') return assertScalarString(value, path);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('json_finite', path);
    return;
  }
  if (typeof value === 'object')
    return enterContainer(value, path, depth, activeContainers, frames);

  reject('json_type', path);
};

export const inspectPlainJson = (value: unknown, basePath: string): PlainJsonInspection => {
  const activeContainers = new WeakSet<object>();
  const frames: TraversalFrame[] = [{ kind: 'enter', value, path: basePath, depth: 1 }];
  let depth = 1;
  let nodes = 0;

  for (let frame = frames.pop(); frame !== undefined; frame = frames.pop()) {
    if (frame.kind === 'exit') {
      activeContainers.delete(frame.value);
      continue;
    }

    nodes += 1;
    depth = Math.max(depth, frame.depth);
    inspectEnterFrame(frame, activeContainers, frames);
  }

  return { depth, nodes };
};
