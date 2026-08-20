export interface InvocationClockPort {
  now(): number;
  schedule(delayMs: number, callback: () => void): () => void;
}
