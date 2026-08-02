export interface ProcessOutputSink {
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
}
