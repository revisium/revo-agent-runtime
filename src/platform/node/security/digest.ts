import { createHash } from 'node:crypto';

import type { Sha256Digest } from '../../../execution/security/digest/port.js';

export const nodeSha256Digest: Sha256Digest = Object.freeze({
  digest: (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex'),
});
