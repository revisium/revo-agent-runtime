import type { LiveOwnedProcess } from './live-owned-process.js';

export type ProcessIoActivationResult =
  | Readonly<{ status: 'activated'; process: LiveOwnedProcess }>
  | Readonly<{ status: 'rejected'; reason: 'internal_invariant_violation' }>;
