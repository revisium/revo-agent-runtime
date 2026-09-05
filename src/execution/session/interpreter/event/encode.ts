import type { AgentSessionEvent } from '../../../../contracts/session/events/event.js';
import { ownedFrozenValue } from '../shared/value/owned.js';

const encoder = new TextEncoder();

export class SessionEventEncodingError extends TypeError {
  constructor() {
    super('Session event exceeds its delivery boundary.');
    this.name = 'SessionEventEncodingError';
  }
}

export const snapshotSessionEvent = <Event extends AgentSessionEvent>(
  event: Event,
  maxBytes: number,
): Event => {
  const snapshot = ownedFrozenValue(event);
  const encoded = JSON.stringify(snapshot);
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    encoded === undefined ||
    encoder.encode(encoded).byteLength > maxBytes
  )
    throw new SessionEventEncodingError();
  return snapshot;
};
