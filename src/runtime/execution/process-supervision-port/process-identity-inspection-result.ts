import type { ProcessIdentity } from './process-identity.js';

export type ProcessIdentityInspectionResult =
  | Readonly<{ status: 'identified'; identity: ProcessIdentity }>
  | Readonly<{ status: 'failed'; reason: 'inspection_failed' | 'fingerprint_failed' | 'deadline' }>;
