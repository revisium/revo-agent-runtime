import type { OutputPreparationQuiescence } from './output-preparation-quiescence.js';
import type { OutputPreparationResult } from './output-preparation-result.js';
import type { TerminalPublicationAuthority } from './terminal-publication-authority.js';

export interface OutputPreparationAttempt {
  readonly invocationId: string;
  readonly outputDirectory: string;
  readonly authority: TerminalPublicationAuthority;
  readonly settlement: Promise<OutputPreparationResult>;
  readonly quiescence: Promise<OutputPreparationQuiescence>;
  requestCancellation(): void;
}
