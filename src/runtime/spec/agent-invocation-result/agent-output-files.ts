export interface AgentOutputFiles {
  readonly directory: string;
  readonly events: 'events.ndjson';
  readonly stdout: 'stdout.log';
  readonly stderr: 'stderr.log';
  readonly result?: 'result.json';
  readonly rawFinalResponse?: 'raw-final-response.txt';
}

export interface AgentCommittedOutputFiles extends AgentOutputFiles {
  readonly result: 'result.json';
}
