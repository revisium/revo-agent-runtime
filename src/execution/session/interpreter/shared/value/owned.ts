const freezeGraph = (root: object): void => {
  const pending: object[] = [root];
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    for (const key of Reflect.ownKeys(value)) {
      const child: unknown = Reflect.getOwnPropertyDescriptor(value, key)?.value;
      if (typeof child === 'object' && child !== null && !Object.isFrozen(child))
        pending.push(child);
    }
    Object.freeze(value);
  }
};

export const ownedFrozenValue = <Value extends object>(value: Value): Value => {
  const owned = structuredClone(value);
  freezeGraph(owned);
  return owned;
};
