export type InvocationTerminalObservation =
  | Readonly<{ status: 'completed'; rawResponse?: Uint8Array }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'failed' }>;
