import { createRedactionChannel } from '../../../../security/redaction/channel.js';
import { ownedFrozenValue } from './owned.js';

const displayFields = new Set(['content', 'message', 'title', 'label', 'description', 'reason']);

const containsSecret = (text: string, secrets: readonly string[]): boolean =>
  secrets.some((secret) => secret.length > 0 && text.includes(secret));

const redactText = (value: string, secrets: readonly string[]): string => {
  const channel = createRedactionChannel(secrets);
  const decoder = new TextDecoder();
  try {
    return (
      decoder.decode(channel.feed(new TextEncoder().encode(value)), { stream: true }) +
      decoder.decode(channel.flush())
    );
  } finally {
    channel.dispose();
  }
};

const redactFieldText = (
  value: string,
  key: string,
  metadata: boolean,
  secrets: readonly string[],
): string => {
  if (metadata || displayFields.has(key)) return redactText(value, secrets);
  if (containsSecret(value, secrets))
    throw new TypeError('A session identity or protocol value contains a secret.');
  return value;
};

export const redactSessionValue = <Value extends object>(
  value: Value,
  secrets: readonly string[],
): Value => {
  const copy = structuredClone(value);
  const pending: Array<{ value: object; metadata: boolean }> = [{ value: copy, metadata: false }];
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    for (const key of Object.keys(entry.value)) {
      if (containsSecret(key, secrets))
        throw new TypeError('A session field name contains a secret.');
      const child: unknown = Reflect.get(entry.value, key);
      const metadata = entry.metadata || key === 'metadata';
      if (typeof child === 'string') {
        Reflect.set(entry.value, key, redactFieldText(child, key, metadata, secrets));
      } else if (typeof child === 'object' && child !== null) {
        pending.push({ value: child, metadata });
      }
    }
  }
  return ownedFrozenValue(copy);
};
