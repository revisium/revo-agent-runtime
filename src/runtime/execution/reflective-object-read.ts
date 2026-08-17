type OwnDataRead = Readonly<{ valid: true; value: unknown }> | Readonly<{ valid: false }>;

interface DataDescriptor {
  readonly value: unknown;
}
interface EnumerableDataDescriptor extends DataDescriptor {
  readonly enumerable: true;
}

const isPlainObservedObject = (value: object): boolean => {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is DataDescriptor => descriptor !== undefined && Object.hasOwn(descriptor, 'value');

const isEnumerableDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is EnumerableDataDescriptor =>
  descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');

const ownEnumerableData = (value: object, key: string): OwnDataRead => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isEnumerableDataDescriptor(descriptor)) return Object.freeze({ valid: false });
  return Object.freeze({ valid: true, value: descriptor.value });
};

const enumerableKeys = function* (value: object): Generator<string> {
  for (const key in value) yield key;
};

export const reflectiveObjectRead = Object.freeze({
  isPlainObservedObject,
  isDataDescriptor,
  isEnumerableDataDescriptor,
  ownEnumerableData,
  enumerableKeys,
});
