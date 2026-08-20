import type { AttachedProtocolSession } from './attached-protocol-session.js';

export type ProtocolAttachResult =
  | Readonly<{ status: 'attached'; session: AttachedProtocolSession }>
  | Readonly<{
      status: 'failed';
      reason: 'attach_failed' | 'stdin_write_failed' | 'stdin_end_failed';
    }>;
