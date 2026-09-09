import type { ProcessIdentity } from '../../../src/process/index.js';

type LegacyIdentity = Extract<ProcessIdentity, { readonly version?: never }>;
export const processIdentity = (overrides: Partial<LegacyIdentity> = {}): LegacyIdentity => ({
  fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  pid: 101,
  processGroupId: 101,
  startedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
