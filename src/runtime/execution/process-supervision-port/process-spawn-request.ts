import type { ProcessOutputSink } from './process-output-sink.js';

export interface ProcessSpawnRequest {
  readonly invocationId: string;
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly stdin: 'pipe';
  readonly stdout: ProcessOutputSink;
  readonly stderr: ProcessOutputSink;
}
