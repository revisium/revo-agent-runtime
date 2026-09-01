const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Retains only the bounded raw session/new result needed by legacy provider adapters. */
export class AcpSessionFrameCapture {
  private response: Readonly<Record<string, unknown>> | undefined;

  observe = (frame: Uint8Array): void => {
    if (this.response !== undefined || frame.byteLength === 0) return;
    try {
      const message: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
      if (!isRecord(message) || !isRecord(message.result)) return;
      if (typeof message.result.sessionId !== 'string') return;
      this.response = message.result;
    } catch {
      return;
    }
  };

  sessionResponse(): Readonly<Record<string, unknown>> | undefined {
    return this.response;
  }
}
