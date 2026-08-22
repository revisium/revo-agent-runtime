import { getTerminalPublicationEventsCapability } from './get-terminal-publication-events-capability.js';

export const getTerminalPublicationInvocationToken = (authority: unknown): object | undefined =>
  getTerminalPublicationEventsCapability(authority)?.invocationToken;
