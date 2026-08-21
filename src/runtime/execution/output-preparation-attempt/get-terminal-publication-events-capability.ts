import { TerminalPublicationAuthority } from './terminal-publication-authority.js';
import { TERMINAL_PUBLICATION_EVENTS_CAPABILITIES } from './terminal-publication-events-capabilities.js';

export const getTerminalPublicationEventsCapability = (authority: unknown) =>
  authority instanceof TerminalPublicationAuthority
    ? TERMINAL_PUBLICATION_EVENTS_CAPABILITIES.get(authority)
    : undefined;
