import type { RetainedCleanupAuthority } from './retained-cleanup-authority.js';

export type ProcessStartQuiescence =
  | Readonly<{
      status: 'quiescent';
      disposition: 'not_spawned' | 'cleanup_confirmed' | 'transferred_to_coordinator';
    }>
  | Readonly<{ status: 'retained'; authority: RetainedCleanupAuthority }>;
