export const parseCanonicalJson = (canonicalBytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes));
