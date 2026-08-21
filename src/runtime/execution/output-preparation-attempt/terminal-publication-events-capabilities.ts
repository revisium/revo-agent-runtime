import type { EventsAppendSink } from '../process-supervision-port/index.js';
import type { TerminalPublicationAuthority } from './terminal-publication-authority.js';

export const TERMINAL_PUBLICATION_EVENTS_CAPABILITIES = new WeakMap<
  TerminalPublicationAuthority,
  Readonly<{
    invocationToken: object;
    eventsAppendSink: EventsAppendSink;
    usage: { nonterminalBytesWritten: number };
  }>
>();
