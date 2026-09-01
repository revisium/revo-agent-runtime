import type { ProcessIdentity } from '../../../src/execution/process/port.js';

export const processIdentity = (overrides: Partial<ProcessIdentity> = {}): ProcessIdentity => ({
  fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  pid: 101,
  processGroupId: 101,
  startedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
