const environmentKeyPattern = /^[A-Za-z_]\w*$/;
const credentialLikeName = /token|secret|password|credential|api[_-]?key|private[_-]?key/i;
const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');

const isStringRecord = (value: unknown): value is Readonly<Record<string, string>> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');

export interface CapturedEnvironment {
  readonly values: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
}

export const captureEnvironment = (
  request: unknown,
  host: Readonly<Record<string, string | undefined>>,
): CapturedEnvironment => {
  const environment: unknown =
    request === undefined ? { inherit: [], secrets: {}, variables: {} } : request;
  if (
    !isRecord(environment) ||
    !isStringArray(environment.inherit) ||
    !isStringRecord(environment.variables) ||
    !isStringRecord(environment.secrets)
  )
    throw new TypeError('Invalid child environment.');
  const values: Record<string, string> = {};
  const secretValues: string[] = [];
  const names = [
    ...environment.inherit,
    ...Reflect.ownKeys(environment.variables),
    ...Reflect.ownKeys(environment.secrets),
  ];
  if (names.length > 128 || new Set(names).size !== names.length)
    throw new TypeError('Invalid child environment.');

  const add = (name: string, value: unknown, secret: boolean): void => {
    if (
      !environmentKeyPattern.test(name) ||
      encoder.encode(name).byteLength > 128 ||
      typeof value !== 'string' ||
      encoder.encode(value).byteLength > 65_536 ||
      (secret && value.length === 0)
    )
      throw new TypeError('Invalid child environment.');
    values[name] = value;
    if (secret) secretValues.push(value);
  };
  for (const name of environment.inherit) {
    if (credentialLikeName.test(name) || host[name] === undefined)
      throw new TypeError('Invalid inherited environment variable.');
    add(name, host[name], false);
  }
  for (const [name, value] of Object.entries(environment.variables)) add(name, value, false);
  for (const [name, value] of Object.entries(environment.secrets)) add(name, value, true);
  const totalBytes = Object.entries(values).reduce(
    (total, [name, value]) =>
      total + encoder.encode(name).byteLength + encoder.encode(value).byteLength,
    0,
  );
  if (totalBytes > 262_144) throw new TypeError('Child environment is too large.');
  return Object.freeze({
    values: Object.freeze({ ...values }),
    secrets: Object.freeze(secretValues),
  });
};
