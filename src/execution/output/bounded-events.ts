import type { AgentEvent } from '../../contracts/manager/events.js';

const encoder = new TextEncoder();

export const encodeBoundedEvents = (
  events: readonly AgentEvent[],
  limits: { readonly maxEventBytes: number; readonly maxEventsFileBytes: number },
): Uint8Array => {
  const serialized: string[] = [];
  let fileBytes = 0;
  for (const event of events) {
    const json = JSON.stringify(event);
    const eventBytes = encoder.encode(json).byteLength;
    if (eventBytes > limits.maxEventBytes) throw new TypeError('Event exceeds its byte limit.');
    fileBytes += eventBytes + 1;
    if (fileBytes > limits.maxEventsFileBytes)
      throw new TypeError('Events file exceeds its byte limit.');
    serialized.push(json);
  }
  return encoder.encode(`${serialized.join('\n')}\n`);
};
