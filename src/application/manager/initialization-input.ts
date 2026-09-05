export interface DecodedManagerInitialization {
  readonly invocations: unknown;
  readonly sessions: unknown;
}

export const decodeManagerInitialization = (
  value: unknown,
): DecodedManagerInitialization | undefined => {
  if (Array.isArray(value)) return { invocations: value, sessions: [] };
  try {
    if (typeof value !== 'object' || value === null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      !keys.includes('invocations') ||
      keys.some((key) => key !== 'invocations' && key !== 'sessions')
    )
      return undefined;
    const invocations = Object.getOwnPropertyDescriptor(value, 'invocations');
    const sessions = Object.getOwnPropertyDescriptor(value, 'sessions');
    if (
      invocations === undefined ||
      !invocations.enumerable ||
      !Object.hasOwn(invocations, 'value') ||
      (sessions !== undefined && (!sessions.enumerable || !Object.hasOwn(sessions, 'value')))
    )
      return undefined;
    return {
      invocations: invocations.value,
      sessions: sessions?.value ?? [],
    };
  } catch {
    return undefined;
  }
};
