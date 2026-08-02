interface PreparedLaunchPin {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
}

interface DataDescriptor {
  readonly value: unknown;
}

const hasExactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
};

const isPlainObservedObject = (value: object): boolean => {
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): descriptor is DataDescriptor => descriptor !== undefined && Object.hasOwn(descriptor, 'value');

const ownNonEmptyString = (value: object, key: string): string | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isDataDescriptor(descriptor)) return undefined;
  return typeof descriptor.value === 'string' && descriptor.value.length > 0
    ? descriptor.value
    : undefined;
};

export class PreparedLaunch {
  readonly pin: PreparedLaunchPin;
  readonly executable: string;
  readonly reportedVersion: string;

  private constructor(pin: PreparedLaunchPin, executable: string, reportedVersion: string) {
    this.pin = Object.freeze({
      agentId: pin.agentId,
      agentVersion: pin.agentVersion,
      definitionDigest: pin.definitionDigest,
    });
    this.executable = executable;
    this.reportedVersion = reportedVersion;
    Object.freeze(this);
  }

  static create(value: unknown): PreparedLaunch | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    if (!isPlainObservedObject(value)) return undefined;
    if (!hasExactKeys(value, ['pin', 'executable', 'reportedVersion'])) return undefined;
    const pinDescriptor = Object.getOwnPropertyDescriptor(value, 'pin');
    if (
      !isDataDescriptor(pinDescriptor) ||
      pinDescriptor.value === null ||
      typeof pinDescriptor.value !== 'object'
    )
      return undefined;
    if (!isPlainObservedObject(pinDescriptor.value)) return undefined;
    if (!hasExactKeys(pinDescriptor.value, ['agentId', 'agentVersion', 'definitionDigest']))
      return undefined;
    const agentId = ownNonEmptyString(pinDescriptor.value, 'agentId');
    const agentVersion = ownNonEmptyString(pinDescriptor.value, 'agentVersion');
    const definitionDigest = ownNonEmptyString(pinDescriptor.value, 'definitionDigest');
    const executable = ownNonEmptyString(value, 'executable');
    const reportedVersion = ownNonEmptyString(value, 'reportedVersion');
    if (
      agentId === undefined ||
      agentVersion === undefined ||
      definitionDigest === undefined ||
      executable === undefined ||
      reportedVersion === undefined
    )
      return undefined;
    return new PreparedLaunch(
      { agentId, agentVersion, definitionDigest },
      executable,
      reportedVersion,
    );
  }
}
