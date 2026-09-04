import { canonicalizeJsonBytes } from '../../../../definition/canonical-json.js';
import type { Sha256Digest } from '../../../../execution/security/digest/port.js';

export const continuationDigest = (value: unknown, digest: Sha256Digest): string =>
  digest.digest(canonicalizeJsonBytes(value));
