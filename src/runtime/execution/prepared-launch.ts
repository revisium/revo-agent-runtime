interface PreparedLaunchPin {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly definitionDigest: string;
}

interface DataDescriptor {
  readonly value: unknown;
}

interface PreparedLaunchLimits {
  readonly wallClockTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxEventBytes: number;
  readonly maxEventsFileBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxRawResponseBytes: number;
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

const ownNumber = (value: object, key: string): number | undefined => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!isDataDescriptor(descriptor)) return undefined;
  return typeof descriptor.value === 'number' && Number.isSafeInteger(descriptor.value)
    ? descriptor.value
    : undefined;
};

const copyLimits = (value: unknown): PreparedLaunchLimits | undefined => {
  if (value === null || typeof value !== 'object') return undefined;
  if (!isPlainObservedObject(value)) return undefined;
  if (
    !hasExactKeys(value, [
      'wallClockTimeoutMs',
      'idleTimeoutMs',
      'maxEventBytes',
      'maxEventsFileBytes',
      'maxStdoutBytes',
      'maxStderrBytes',
      'maxRawResponseBytes',
    ])
  )
    return undefined;
  const wallClockTimeoutMs = ownNumber(value, 'wallClockTimeoutMs');
  const idleTimeoutMs = ownNumber(value, 'idleTimeoutMs');
  const maxEventBytes = ownNumber(value, 'maxEventBytes');
  const maxEventsFileBytes = ownNumber(value, 'maxEventsFileBytes');
  const maxStdoutBytes = ownNumber(value, 'maxStdoutBytes');
  const maxStderrBytes = ownNumber(value, 'maxStderrBytes');
  const maxRawResponseBytes = ownNumber(value, 'maxRawResponseBytes');
  if (
    wallClockTimeoutMs === undefined ||
    idleTimeoutMs === undefined ||
    maxEventBytes === undefined ||
    maxEventsFileBytes === undefined ||
    maxStdoutBytes === undefined ||
    maxStderrBytes === undefined ||
    maxRawResponseBytes === undefined
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
  readonly limits: PreparedLaunchLimits;
  readonly reportedVersion: string;

  private constructor(
    pin: PreparedLaunchPin,
    executable: string,
    reportedVersion: string,
    limits: PreparedLaunchLimits,
  ) {
    this.pin = Object.freeze({
      agentId: pin.agentId,
      agentVersion: pin.agentVersion,
      definitionDigest: pin.definitionDigest,
    });
    this.executable = executable;
    this.limits = limits;
    this.reportedVersion = reportedVersion;
    Object.freeze(this);
  }

  static create(value: unknown): PreparedLaunch | undefined {
    if (value === null || typeof value !== 'object') return undefined;
    if (!isPlainObservedObject(value)) return undefined;
    if (!hasExactKeys(value, ['pin', 'executable', 'reportedVersion', 'limits'])) return undefined;
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
    const limitsDescriptor = Object.getOwnPropertyDescriptor(value, 'limits');
    const limits = isDataDescriptor(limitsDescriptor)
      ? copyLimits(limitsDescriptor.value)
      : undefined;
    if (
      agentId === undefined ||
      agentVersion === undefined ||
      definitionDigest === undefined ||
      executable === undefined ||
      reportedVersion === undefined ||
      limits === undefined
    )
      return undefined;
    return new PreparedLaunch(
      { agentId, agentVersion, definitionDigest },
      executable,
      reportedVersion,
      limits,
    );
  }
}
