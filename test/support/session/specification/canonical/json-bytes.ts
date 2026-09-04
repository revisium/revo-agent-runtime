import canonicalize from 'canonicalize';

const encoder = new TextEncoder();

export const canonicalJsonBytes = (value: unknown): Uint8Array => {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new TypeError('Value cannot be represented as canonical JSON');
  return encoder.encode(canonical);
};
