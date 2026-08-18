export interface RedactionChannel {
  feed(chunk: Uint8Array): Uint8Array;
  flush(): Uint8Array;
  dispose(): void;
}
