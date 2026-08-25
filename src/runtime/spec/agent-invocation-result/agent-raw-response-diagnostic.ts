export interface AgentRawResponseDiagnostic {
  readonly preview: string;
  readonly truncated: boolean;
  readonly file?: 'raw-final-response.txt';
}
