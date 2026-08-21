import type { AgentEvent, AgentInvocationResult } from '../../spec/index.js';
import type { TerminalPublicationAuthority } from '../output-preparation-attempt/index.js';
import type { OutputAppendResult } from './output-append-result.js';
import type { ScratchCleanupResult } from './scratch-cleanup-result.js';
import type { TerminalResultPublicationResult } from './terminal-result-publication-result.js';

// Deliberately not the full spec InvocationOutputPort: publishRawResponse and quiesce are deferred to later slices.
export interface TerminalPublicationPort {
  appendLifecycleEvent(
    authority: TerminalPublicationAuthority,
    event: AgentEvent,
  ): Promise<OutputAppendResult>;
  publishTerminalResult(
    authority: TerminalPublicationAuthority,
    result: AgentInvocationResult,
  ): Promise<TerminalResultPublicationResult>;
  cleanupScratch(authority: TerminalPublicationAuthority): Promise<ScratchCleanupResult>;
}
