import type { TerminalPublicationAuthority } from './terminal-publication-authority.js';

export type OutputPreparationQuiescence =
  | Readonly<{ status: 'quiescent'; mutationDispatched: boolean }>
  | Readonly<{ status: 'retained'; authority: TerminalPublicationAuthority }>;
