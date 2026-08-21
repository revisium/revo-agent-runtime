export interface EventsAppendSink {
  write(chunk: Uint8Array): Promise<void>;
  flush(): Promise<void>;
}
