import canonicalize from 'canonicalize';

const encoder = new TextEncoder();

export const canonicalJsonBytes = (value: unknown): Uint8Array => {
  const json = canonicalize(value);
  if (json === undefined) throw new TypeError('Cannot canonicalize undefined JSON.');
  return encoder.encode(json);
};
