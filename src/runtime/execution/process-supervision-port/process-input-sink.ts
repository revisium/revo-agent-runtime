export interface ProcessInputSink {
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
  abort(): Promise<void>;
}
