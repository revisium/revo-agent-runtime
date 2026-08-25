export const createNamedHostEnvironmentSnapshot = (
  names: readonly string[],
): Readonly<Record<string, string>> => {
  const snapshot: Record<string, string> = {};
  Object.setPrototypeOf(snapshot, null);
  for (const name of names) {
    const value = process.env[name];
    if (value === undefined) continue;
    Object.defineProperty(snapshot, name, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
};
