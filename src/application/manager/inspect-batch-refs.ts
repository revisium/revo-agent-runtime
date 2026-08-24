type BatchInspection =
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'limit' }>
  | Readonly<{ status: 'valid'; refs: readonly unknown[] }>;

export const inspectBatchRefs = (value: unknown, limit: number): BatchInspection => {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
      return Object.freeze({ status: 'invalid' });

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.enumerable ||
      lengthDescriptor.configurable
    )
      return Object.freeze({ status: 'invalid' });

    const length = lengthDescriptor.value;
    if (length > limit) return Object.freeze({ status: 'limit' });

    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.at(-1) !== 'length')
      return Object.freeze({ status: 'invalid' });

    const refs: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (keys[index] !== key) return Object.freeze({ status: 'invalid' });

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
        return Object.freeze({ status: 'invalid' });
      refs.push(descriptor.value);
    }

    return Object.freeze({ status: 'valid', refs: Object.freeze(refs) });
  } catch {
    return Object.freeze({ status: 'invalid' });
  }
};
