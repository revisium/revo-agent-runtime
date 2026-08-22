export interface AgentRawResponseDiagnostic {
  readonly byteLength: number;
  readonly retainedByteLength: number;
  readonly preview: string;
  readonly truncated: boolean;
  readonly file?: 'raw-final-response.txt';
}
